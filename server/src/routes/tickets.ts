import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { requireSession } from '../session/middleware.js';
import { config } from '../config.js';

export const ticketsRouter = Router();

function err(e: unknown, fallback: string) {
  if (e instanceof ITHubError) {
    return {
      status: e.status || 500,
      body: { error: { code: e.code, message_zh: e.upstreamMessage || fallback } },
    };
  }
  return { status: 500, body: { error: { code: 'UNKNOWN', message_zh: fallback } } };
}

ticketsRouter.get('/', requireSession, async (req, res): Promise<void> => {
  try {
    const offset = Number(req.query.offset ?? 0);
    const count = Number(req.query.count ?? 50);
    const data = await ithubFetch<any>('/api/ServiceDesk/Tickets', {
      accessToken: req.session!.accessToken,
      query: { offset, count },
    });
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取工单列表失败');
    res.status(status).json(body);
  }
});

ticketsRouter.get('/:id', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>(
      `/api/ServiceDesk/Tickets/${req.params.id}`,
      { accessToken: req.session!.accessToken },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取工单详情失败');
    res.status(status).json(body);
  }
});

ticketsRouter.get('/:id/journals', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>(
      `/api/ServiceDesk/Tickets/${req.params.id}/TicketJournals`,
      { accessToken: req.session!.accessToken },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取工单日志失败');
    res.status(status).json(body);
  }
});

ticketsRouter.post('/by-checkpoint', requireSession, async (req, res): Promise<void> => {
  try {
    const { checkPoint } = req.body ?? {};
    if (!checkPoint) {
      res.status(400).json({ error: { code: 'INVALID', message_zh: '缺少 checkPoint' } });
      return;
    }
    const data = await ithubFetch<any>('/api/ServiceDesk/Tickets/ByCheckPoint', {
      method: 'POST',
      accessToken: req.session!.accessToken,
      body: { CheckPoint: checkPoint },
    });
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取工单模板失败');
    res.status(status).json(body);
  }
});

// Create ticket using the actual ITHub pattern:
//   POST /api/ServiceDesk/Customers/{customerTag}/TicketTemplates/{templateId}/Ticket{Incidents|Problems|Changes|Requests}
// with `ApiKey` header and minimal body {Summary, Description, Priority, Impact, Urgency}.
// (Bare POST /api/ServiceDesk/Tickets returns 404 from ITHub — that path
// doesn't accept the user-AccessToken auth we have, only the tenant ApiKey.)
//
// Body accepted from the caller: { templateId, ticketType, summary, description }.
// ticketType maps 0=Incidents, 1=Problems, 2=Changes, 3=Requests. If missing
// we look it up from the template detail.
ticketsRouter.post('/', requireSession, async (req, res): Promise<void> => {
  const { templateId, ticketType, summary, description } = req.body ?? {};
  if (typeof templateId !== 'number' || !summary) {
    res.status(400).json({ error: { code: 'INVALID', message_zh: '缺少 templateId / summary' } });
    return;
  }
  if (!config.ithub.apiKey) {
    res.status(500).json({
      error: {
        code: 'NO_API_KEY',
        message_zh: '服务端未配置 ITHUB_API_KEY，请在 server/.env 和 Render Environment 中添加',
      },
    });
    return;
  }
  // Resolve ticket type if caller didn't pass it.
  let type = ticketType;
  if (typeof type !== 'number') {
    try {
      const detail = (await ithubFetch<any>(`/api/ServiceDesk/TicketTemplates/${templateId}`, {
        accessToken: req.session!.accessToken,
      })) as Record<string, unknown>;
      type = detail.TicketType;
    } catch (e) {
      const { status, body } = err(e, '获取模板类型失败');
      res.status(status).json(body);
      return;
    }
  }
  const typeMap: Record<number, string> = { 0: 'TicketIncidents', 1: 'TicketProblems', 2: 'TicketChanges', 3: 'TicketRequests' };
  const sub = typeMap[type as number];
  if (!sub) {
    res.status(400).json({ error: { code: 'INVALID', message_zh: `未知 TicketType: ${type}` } });
    return;
  }
  const path = `/api/ServiceDesk/Customers/${config.ithub.customerTag}/TicketTemplates/${templateId}/${sub}`;
  try {
    const data = await ithubFetch<any>(path, {
      method: 'POST',
      apiKey: config.ithub.apiKey,
      body: {
        Summary: String(summary).slice(0, 200),
        Description: String(description ?? summary),
        Priority: 3,
        Impact: 3,
        Urgency: 3,
      },
    });
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '创建工单失败');
    res.status(status).json(body);
  }
});

// Append a comment to a ticket via PUT
ticketsRouter.put('/:id', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>(`/api/ServiceDesk/Tickets/${req.params.id}`, {
      method: 'PUT',
      accessToken: req.session!.accessToken,
      body: req.body,
    });
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '更新工单失败');
    res.status(status).json(body);
  }
});

// Add a journal/comment to a ticket. ITHub rejects adding journals while
// the ticket is in the "Registered" (state 0) state with
// TicketInRegisteredStatusException, so we first transition to "Open"
// (state 1) if needed. State field name and endpoint suffix depend on
// the ticket type (0=Incident, 1=Problem, 2=Change, 3=Request).
//
// Body: { content: string }
ticketsRouter.post('/:id/journals', requireSession, async (req, res): Promise<void> => {
  const ticketId = req.params.id;
  const content = String(req.body?.content ?? '').trim();
  if (!content) {
    res.status(400).json({ error: { code: 'INVALID', message_zh: '备注内容不能为空' } });
    return;
  }

  // Pull ticket detail to learn TicketType and current IncidentState.
  let ticket: Record<string, unknown> = {};
  try {
    ticket = (await ithubFetch<any>(`/api/ServiceDesk/Tickets/${ticketId}`, {
      accessToken: req.session!.accessToken,
    })) as Record<string, unknown>;
  } catch (e) {
    const { status, body } = err(e, '获取工单失败');
    res.status(status).json(body);
    return;
  }

  const ticketType = Number(ticket.TicketType ?? 0);
  const stateFieldMap: Record<number, { field: string; endpoint: string }> = {
    0: { field: 'IncidentStateUpdate', endpoint: 'TicketIncidents' },
    1: { field: 'ProblemStateUpdate', endpoint: 'TicketProblems' },
    2: { field: 'ChangeStateUpdate', endpoint: 'TicketChanges' },
    3: { field: 'RequestStateUpdate', endpoint: 'TicketRequests' },
  };
  const stateInfo = stateFieldMap[ticketType] ?? stateFieldMap[0];

  // For incidents, also need IncidentState specifically (TicketState is
  // a generic "Registered"/"Open" string for the UI, but state transitions
  // are driven by the typed field).
  const currentState = Number(
    ticket.IncidentState ?? ticket.ProblemState ?? ticket.ChangeState ?? ticket.RequestState ?? 0,
  );

  if (currentState === 0) {
    try {
      await ithubFetch<any>(`/api/ServiceDesk/${stateInfo.endpoint}/${ticketId}/State`, {
        method: 'PUT',
        accessToken: req.session!.accessToken,
        body: {
          [stateInfo.field]: 1,
          TicketSuspendData: null,
          TicketClosureData: null,
        },
      });
    } catch (e) {
      // Don't block the comment on a failed state transition — ITHub might
      // already be in a non-Registered state, or the user lacks permission.
      // If the journal POST below also fails, the real error will surface.
      console.warn(`[ticket] state transition skipped for ${ticketId}:`, (e as Error)?.message);
    }
  }

  // Convert plain text to the <p>...</p> HTML ITHub expects.
  const html = '<p>' + content.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';

  try {
    const data = await ithubFetch<any>('/api/ServiceDesk/TicketJournals', {
      method: 'POST',
      accessToken: req.session!.accessToken,
      body: {
        TicketId: Number(ticketId),
        Html: html,
        PrivateToCustomer: false,
        IsDraft: false,
        ContactId: null,
        ContactType: null,
        IncludeChildren: false,
      },
    });
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '添加备注失败');
    res.status(status).json(body);
  }
});