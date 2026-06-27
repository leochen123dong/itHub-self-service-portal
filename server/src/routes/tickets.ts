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