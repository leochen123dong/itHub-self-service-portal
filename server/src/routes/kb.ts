import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { config } from '../config.js';
import { requireSession } from '../session/middleware.js';

export const kbRouter = Router();

function requireKbId(): number {
  if (!config.ai.kbId) {
    throw new ITHubError(
      503,
      'NO_KB',
      '知识库未配置，请在 server/.env 设置 KB_ID',
    );
  }
  return parseInt(config.ai.kbId, 10);
}

function err(err: unknown, fallback: string) {
  if (err instanceof ITHubError) {
    return {
      status: err.status || 500,
      body: { error: { code: err.code, message_zh: err.upstreamMessage || fallback } },
    };
  }
  return { status: 500, body: { error: { code: 'UNKNOWN', message_zh: fallback } } };
}

kbRouter.get('/articles', requireSession, async (req, res): Promise<void> => {
  try {
    const kbId = requireKbId();
    const data = await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
      { accessToken: req.session!.accessToken },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取知识库文章失败');
    res.status(status).json(body);
  }
});

kbRouter.get('/articles/:id', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>(
      `/api/Knowledge/KnowledgeArticles/${req.params.id}`,
      { accessToken: req.session!.accessToken },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '获取文章失败');
    res.status(status).json(body);
  }
});

kbRouter.post('/search', requireSession, async (req, res): Promise<void> => {
  try {
    const kbId = requireKbId();
    const { query, topK } = req.body ?? {};
    if (!query) {
      res.status(400).json({ error: { code: 'INVALID', message_zh: '请输入查询内容' } });
      return;
    }
    const data = await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${kbId}/EmbeddingSearch`,
      {
        method: 'POST',
        accessToken: req.session!.accessToken,
        body: { Query: query, TopK: topK ?? 10 },
      },
    );
    res.json(data);
  } catch (e) {
    const { status, body } = err(e, '搜索失败');
    res.status(status).json(body);
  }
});