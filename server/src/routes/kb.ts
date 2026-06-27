import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { config } from '../config.js';
import { resolveKbId } from '../ai/kbContext.js';
import { requireSession } from '../session/middleware.js';

export const kbRouter = Router();

async function getKbId(req: any): Promise<number> {
  if (config.ai.kbId) return parseInt(config.ai.kbId, 10);
  const id = await resolveKbId(req.session!.accessToken, config.ithub.customerTag);
  if (!id) {
    throw new ITHubError(
      503,
      'NO_KB',
      '该租户下未找到知识库，请联系管理员配置 KB_ID',
    );
  }
  return id;
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
    const kbId = await getKbId(req);
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
    const kbId = await getKbId(req);
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