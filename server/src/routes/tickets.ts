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
    if (!config.ithub.apiKey) {
      res.status(500).json({
        error: {
          code: 'NO_API_KEY',
          message_zh: '服务端未配置 ITHUB_API_KEY，无法读取工单列表',
        },
      });
      return;
    }
    // ITHub list endpoint requires the customer tag in the path and the
    // tenant ApiKey header — bare /api/ServiceDesk/Tickets returns 404.
    const data = await ithubFetch<any>(
      `/api/ServiceDesk/Customers/${config.ithub.customerTag}/Tickets`,
      { apiKey: config.ithub.apiKey, query: { offset, count } },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取工单列表失败');
    res.status(status).json(body);
  }
});

// Admin-only debug: fetch a ticket from ITHub with arbitrary $expand/$select
// to probe for presence / color fields. Returns the raw ITHub body so we
// can see exactly what the upstream returns. Not for production use — keep
// behind requireAdmin.
ticketsRouter.get('/_debug/ithub-ticket/:id', requireSession, async (req, res): Promise<void> => {
  if (!config.admin.identities.includes(req.session!.userName)) {
    res.status(403).json({ error: { code: 'NOT_ADMIN', message_zh: '仅管理员可访问' } });
    return;
  }
  if (!config.ithub.apiKey) {
    res.status(500).json({ error: { code: 'NO_API_KEY', message_zh: '服务端未配置 ITHUB_API_KEY' } });
    return;
  }
  const allowedOdata = ['$expand', '$select'];
  const query: Record<string, string> = {};
  for (const k of allowedOdata) {
    const v = req.query[k];
    if (typeof v === 'string' && v.length < 200) query[k] = v;
  }
  try {
    const data = await ithubFetch<any>(
      `/api/ServiceDesk/Tickets/${req.params.id}`,
      {
        accessToken: req.session!.accessToken,
        apiKey: config.ithub.apiKey,
        ...(Object.keys(query).length ? { query } : {}),
      },
    );
    res.json({
      queriedExpand: query.$expand ?? null,
      queriedSelect: query.$select ?? null,
      assignedUserRaw: data?.AssignedUser ?? null,
      assignedUserKeys: data?.AssignedUser ? Object.keys(data.AssignedUser) : [],
      hasIsOnline: data?.AssignedUser && (
        'IsOnline' in data.AssignedUser ||
        'Online' in data.AssignedUser ||
        'Presence' in data.AssignedUser ||
        'IsPresent' in data.AssignedUser
      ),
      hasColor: data?.AssignedUser && (
        'HtmlColor' in data.AssignedUser ||
        'Color' in data.AssignedUser ||
        'PresenceColor' in data.AssignedUser ||
        'HtmlColour' in data.AssignedUser
      ),
    });
  } catch (e) {
    const { status, body } = err(e, 'ITHub 探测失败');
    res.status(status).json(body);
  }
});

// ITHub returns more populated ticket objects (assigned user, color, online
// status) when both the tenant ApiKey AND the user AccessToken are sent.
// Without the ApiKey the assigned-user fields are stripped.
ticketsRouter.get('/:id', requireSession, async (req, res): Promise<void> => {
  if (!config.ithub.apiKey) {
    res.status(500).json({
      error: { code: 'NO_API_KEY', message_zh: '服务端未配置 ITHUB_API_KEY' },
    });
    return;
  }
  try {
    // Forward OData $expand / $select so the client can probe for presence
    // and color on AssignedUser without us having to bake the field list
    // in. Whitelist known OData params + cap length to avoid smuggling
    // arbitrary query strings to ITHub.
    const allowedOdata = ['$expand', '$select'];
    const query: Record<string, string> = {};
    for (const k of allowedOdata) {
      const v = req.query[k];
      if (typeof v === 'string' && v.length < 200) query[k] = v;
    }
    const data = await ithubFetch<any>(
      `/api/ServiceDesk/Tickets/${req.params.id}`,
      {
        accessToken: req.session!.accessToken,
        apiKey: config.ithub.apiKey,
        ...(Object.keys(query).length ? { query } : {}),
      },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取工单详情失败');
    res.status(status).json(body);
  }
});

ticketsRouter.get('/:id/journals', requireSession, async (req, res): Promise<void> => {
  if (!config.ithub.apiKey) {
    res.status(500).json({
      error: { code: 'NO_API_KEY', message_zh: '服务端未配置 ITHUB_API_KEY' },
    });
    return;
  }
  try {
    const data = await ithubFetch<any>(
      `/api/ServiceDesk/Tickets/${req.params.id}/TicketJournals`,
      {
        accessToken: req.session!.accessToken,
        apiKey: config.ithub.apiKey,
      },
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
// Shared helper: create a ticket via the customer-scoped ITHub endpoint and
// return the created ticket object. Throws ITHubError on upstream failure so
// the caller can format its own error response.
async function createTicketCore(opts: {
  accessToken: string;
  templateId: number;
  ticketType?: number;
  summary: string;
  description?: string;
}): Promise<Record<string, unknown>> {
  if (!config.ithub.apiKey) {
    throw new ITHubError(500, 'NO_API_KEY', '服务端未配置 ITHUB_API_KEY');
  }
  // Resolve ticket type if caller didn't pass it.
  let type = opts.ticketType;
  if (typeof type !== 'number') {
    const detail = (await ithubFetch<any>(`/api/ServiceDesk/TicketTemplates/${opts.templateId}`, {
      accessToken: opts.accessToken,
    })) as Record<string, unknown>;
    type = detail.TicketType as number;
  }
  const typeMap: Record<number, string> = {
    0: 'TicketIncidents',
    1: 'TicketProblems',
    2: 'TicketChanges',
    3: 'TicketRequests',
  };
  const sub = typeMap[type as number];
  if (!sub) throw new ITHubError(400, 'INVALID', `未知 TicketType: ${type}`);
  const path = `/api/ServiceDesk/Customers/${config.ithub.customerTag}/TicketTemplates/${opts.templateId}/${sub}`;
  return (await ithubFetch<any>(path, {
    method: 'POST',
    apiKey: config.ithub.apiKey,
    body: {
      Summary: String(opts.summary).slice(0, 200),
      Description: String(opts.description ?? opts.summary),
      Priority: 3,
      Impact: 3,
      Urgency: 3,
    },
  })) as Record<string, unknown>;
}

ticketsRouter.post('/', requireSession, async (req, res): Promise<void> => {
  const { templateId, ticketType, summary, description } = req.body ?? {};
  if (typeof templateId !== 'number' || !summary) {
    res.status(400).json({ error: { code: 'INVALID', message_zh: '缺少 templateId / summary' } });
    return;
  }
  try {
    const data = await createTicketCore({
      accessToken: req.session!.accessToken,
      templateId,
      ticketType,
      summary,
      description,
    });
    res.json(data);
  } catch (e) {
    if (e instanceof ITHubError && e.code === 'NO_API_KEY') {
      res.status(500).json({
        error: {
          code: 'NO_API_KEY',
          message_zh: '服务端未配置 ITHUB_API_KEY，请在 server/.env 和 Render Environment 中添加',
        },
      });
      return;
    }
    const { status, body } = err(e, '创建工单失败');
    res.status(status).json(body);
  }
});

// Atomic "AI chat → ticket" pipeline: create the ticket AND post the chat
// transcript as a journal so it shows up in ITHub's Journals view. If the
// journal write fails, the ticket is still returned — we don't roll back a
// successful create just because a side-effect failed.
//
// Body: { templateId, ticketType?, summary, description?, chatTranscript }
// chatTranscript is an HTML string built by the client from the chat history
// (e.g. "<p>用户：VPN 连不上</p><p>AI：...</p>").
ticketsRouter.post('/escalate', requireSession, async (req, res): Promise<void> => {
  const { templateId, ticketType, summary, description, chatTranscript } = req.body ?? {};
  if (typeof templateId !== 'number' || !summary) {
    res.status(400).json({ error: { code: 'INVALID', message_zh: '缺少 templateId / summary' } });
    return;
  }

  // Step 1: create the ticket.
  let ticket: Record<string, unknown>;
  try {
    ticket = await createTicketCore({
      accessToken: req.session!.accessToken,
      templateId,
      ticketType,
      summary,
      description,
    });
  } catch (e) {
    if (e instanceof ITHubError && e.code === 'NO_API_KEY') {
      res.status(500).json({
        error: {
          code: 'NO_API_KEY',
          message_zh: '服务端未配置 ITHUB_API_KEY，无法创建工单',
        },
      });
      return;
    }
    const { status, body } = err(e, '创建工单失败');
    res.status(status).json(body);
    return;
  }

  const ticketId = ticket.TicketId ?? ticket.Id;
  if (!ticketId) {
    res.status(502).json({
      error: { code: 'NO_TICKET_ID', message_zh: 'ITHub 未返回 TicketId' },
    });
    return;
  }

  // Step 2: post the chat transcript as a journal. Skip silently if empty.
  const transcript = String(chatTranscript ?? '').trim();
  if (!transcript) {
    res.json({ ...ticket, journalPosted: false, journalError: 'chatTranscript 为空，跳过同步备注' });
    return;
  }

  try {
    await appendJournalAsHtml(String(ticketId), transcript, req.session!.accessToken);
    res.json({ ...ticket, journalPosted: true });
  } catch (e) {
    // Don't 500 the whole request — the ticket exists, just the journal didn't.
    const zh = e instanceof ITHubError ? e.upstreamMessage || 'ITHub 拒绝' : '备注同步失败';
    console.warn(`[ticket] journal sync failed for ${ticketId}:`, (e as Error)?.message);
    res.json({ ...ticket, journalPosted: false, journalError: zh });
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

// Shared helper: append an HTML-formatted journal to a ticket. Auto-transitions
// Registered (state 0) → Open (state 1) before writing. Throws ITHubError on
// failure (caller can decide whether to swallow or surface).
async function appendJournalAsHtml(
  ticketId: string | number,
  html: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  // Pull ticket detail to learn TicketType and current state.
  const ticket = (await ithubFetch<any>(`/api/ServiceDesk/Tickets/${ticketId}`, {
    accessToken,
  })) as Record<string, unknown>;

  const ticketType = Number(ticket.TicketType ?? 0);
  const stateFieldMap: Record<number, { field: string; endpoint: string }> = {
    0: { field: 'IncidentStateUpdate', endpoint: 'TicketIncidents' },
    1: { field: 'ProblemStateUpdate', endpoint: 'TicketProblems' },
    2: { field: 'ChangeStateUpdate', endpoint: 'TicketChanges' },
    3: { field: 'RequestStateUpdate', endpoint: 'TicketRequests' },
  };
  const stateInfo = stateFieldMap[ticketType] ?? stateFieldMap[0];
  const currentState = Number(
    ticket.IncidentState ?? ticket.ProblemState ?? ticket.ChangeState ?? ticket.RequestState ?? 0,
  );

  if (currentState === 0) {
    try {
      await ithubFetch<any>(`/api/ServiceDesk/${stateInfo.endpoint}/${ticketId}/State`, {
        method: 'PUT',
        accessToken,
        body: {
          [stateInfo.field]: 1,
          TicketSuspendData: null,
          TicketClosureData: null,
        },
      });
    } catch (e) {
      // Don't block the journal on a failed state transition — ITHub might
      // already be in a non-Registered state, or the user lacks permission.
      // If the journal POST also fails, the real error will surface.
      console.warn(`[ticket] state transition skipped for ${ticketId}:`, (e as Error)?.message);
    }
  }

  return (await ithubFetch<any>('/api/ServiceDesk/TicketJournals', {
    method: 'POST',
    accessToken,
    body: {
      TicketId: Number(ticketId),
      Html: html,
      PrivateToCustomer: false,
      IsDraft: false,
      ContactId: null,
      ContactType: null,
      IncludeChildren: false,
    },
  })) as Record<string, unknown>;
}

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

  // Convert plain text to the <p>...</p> HTML ITHub expects.
  const html = '<p>' + content.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';

  try {
    const data = await appendJournalAsHtml(ticketId, html, req.session!.accessToken);
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '添加备注失败');
    res.status(status).json(body);
  }
});