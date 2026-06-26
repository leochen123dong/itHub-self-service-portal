import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { requireSession } from '../session/middleware.js';

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

// Generic ticket create — body shape depends on template. Caller passes full payload.
ticketsRouter.post('/', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>('/api/ServiceDesk/Tickets', {
      method: 'POST',
      accessToken: req.session!.accessToken,
      body: req.body,
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