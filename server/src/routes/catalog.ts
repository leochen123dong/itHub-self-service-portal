import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { requireSession } from '../session/middleware.js';

export const catalogRouter = Router();

function err(e: unknown, fallback: string) {
  if (e instanceof ITHubError) {
    return {
      status: e.status || 500,
      body: { error: { code: e.code, message_zh: e.upstreamMessage || fallback } },
    };
  }
  return { status: 500, body: { error: { code: 'UNKNOWN', message_zh: fallback } } };
}

catalogRouter.get('/', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>('/api/ServiceDesk/TicketTemplates', {
      accessToken: req.session!.accessToken,
    });
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取服务目录失败');
    res.status(status).json(body);
  }
});

catalogRouter.get('/:id/menu', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>(
      `/api/ServiceDesk/TicketTemplates/${req.params.id}/Menu`,
      { accessToken: req.session!.accessToken },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取菜单失败');
    res.status(status).json(body);
  }
});

catalogRouter.get('/:id', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>(
      `/api/ServiceDesk/TicketTemplates/${req.params.id}`,
      { accessToken: req.session!.accessToken },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取模板详情失败');
    res.status(status).json(body);
  }
});

catalogRouter.get('/:id/config', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>(
      `/api/ServiceDesk/TicketTemplates/${req.params.id}/Config`,
      { accessToken: req.session!.accessToken },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取表单配置失败');
    res.status(status).json(body);
  }
});