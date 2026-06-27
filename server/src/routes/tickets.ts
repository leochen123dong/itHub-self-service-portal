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

// Probe endpoint: try several (path × payload) combinations to find the
// create shape ITHub actually accepts. Returns the first success or all
// failures. Cast a wide net: 6 paths × 3 payloads = 18 trials.
ticketsRouter.post('/_probe', requireSession, async (req, res): Promise<void> => {
  const { templateId, summary, description } = req.body ?? {};
  if (typeof templateId !== 'number') {
    res.status(400).json({ error: { code: 'INVALID', message_zh: '缺少 templateId' } });
    return;
  }
  const results: Array<{ variant: string; status: number; body: unknown }> = [];

  const paths = [
    '/api/ServiceDesk/Tickets',
    '/api/ServiceDesk/Tickets/Create',
    '/api/ServiceDesk/Tickets/Save',
    '/api/ServiceDesk/Ticket',
    '/api/ServiceDesk/Ticket/Create',
    '/api/ServiceDesk/Ticket/Save',
  ];

  // Pull the full template detail once and derive payloads from it.
  let detail: Record<string, unknown> = {};
  try {
    detail = (await ithubFetch<any>(`/api/ServiceDesk/TicketTemplates/${templateId}`, {
      accessToken: req.session!.accessToken,
    })) as Record<string, unknown>;
  } catch (e) {
    const { status, body } = err(e, '拉模板失败');
    res.status(status).json({ error: body });
    return;
  }

  function dropNulls(o: Record<string, unknown>): Record<string, unknown> {
    for (const k of Object.keys(o)) {
      if (o[k] === null || o[k] === undefined) delete o[k];
    }
    return o;
  }

  const minimal = dropNulls({
    TicketTemplateId: templateId,
    Summary: summary,
    Description: description,
  });
  const rich = dropNulls({
    ...minimal,
    TicketGroupId: detail.TicketGroupId,
    TicketType: detail.TicketType,
    OwnerUserGroupId: detail.OwnerUserGroupId,
    AssignedUserGroupId: detail.AssignedUserGroupId,
    ServiceLevelId: detail.ServiceLevelId,
    TimeZoneInfoId: detail.TimeZoneInfoId,
    SecurityContainerSid: detail.SecurityContainerSid,
  });
  // ITHub sometimes uses TemplateId (no Ticket prefix). Same for the group
  // and container fields — try with the bare names too.
  const altNames = dropNulls({
    TemplateId: templateId,
    Summary: summary,
    Description: description,
    GroupId: detail.TicketGroupId,
    Type: detail.TicketType,
    OwnerUserGroupId: detail.OwnerUserGroupId,
    AssignedUserGroupId: detail.AssignedUserGroupId,
    ServiceLevelId: detail.ServiceLevelId,
    TimeZoneInfoId: detail.TimeZoneInfoId,
    Sid: detail.SecurityContainerSid,
  });

  const trials: Array<{ name: string; path: string; body: unknown }> = [];
  for (const p of paths) {
    trials.push({ name: `path=${p} payload=minimal`, path: p, body: { ...minimal } });
    trials.push({ name: `path=${p} payload=rich`, path: p, body: { ...rich } });
    trials.push({ name: `path=${p} payload=altNames`, path: p, body: { ...altNames } });
  }

  for (const t of trials) {
    try {
      const data = await ithubFetch<any>(t.path, {
        method: 'POST',
        accessToken: req.session!.accessToken,
        body: t.body,
      });
      results.push({ variant: t.name, status: 200, body: data });
      res.json({ succeeded: t.name, results });
      return;
    } catch (e) {
      const { status, body } = err(e, `${t.name} 失败`);
      results.push({ variant: t.name, status, body });
    }
  }

  res.status(404).json({ message: '全部变体均失败', results });
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