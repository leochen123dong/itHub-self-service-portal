import { Router } from 'express';
import { config } from '../config.js';
import { ithubFetch } from '../http/ithubClient.js';
import { resolveKbId } from '../ai/kbContext.js';
import { requireSession } from '../session/middleware.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    customerTag: config.ithub.customerTag,
    aiBackend: config.minimax.enabled ? 'MiniMax' : 'ITHub',
    aiModel: config.minimax.enabled ? config.minimax.model : null,
    kbId: config.ai.kbId ?? null,
    time: new Date().toISOString(),
  });
});

healthRouter.get('/debug/kbs', requireSession, async (req, res): Promise<void> => {
  try {
    const customerTag = config.ithub.customerTag;
    const list = await ithubFetch<any[]>('/api/Knowledge/KnowledgeBases', {
      accessToken: req.session!.accessToken,
    });
    const discoveredId = await resolveKbId(req.session!.accessToken, customerTag);
    res.json({
      customerTag,
      envKbIdOverride: config.ai.kbId ?? null,
      autoDiscoveredId: discoveredId,
      effectiveKbId: config.ai.kbId ?? discoveredId,
      count: Array.isArray(list) ? list.length : 0,
      knowledgeBases: Array.isArray(list)
        ? list.map((k: any) => ({
            KnowledgeBaseId: k.KnowledgeBaseId ?? k.Id,
            Name: k.Name,
            Active: k.Active ?? k.IsActive,
            raw: k,
          }))
        : list,
    });
  } catch (e: any) {
    res.status(e?.status || 500).json({
      error: { code: e?.code || 'DEBUG_KBS_FAILED', message_zh: e?.message || '未知错误', raw: e?.upstreamMessage },
    });
  }
});

healthRouter.get('/debug/kb/:id/articles', requireSession, async (req, res): Promise<void> => {
  try {
    const kbId = parseInt(req.params.id, 10);
    const data = await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
      { accessToken: req.session!.accessToken },
    );
    res.json({ kbId, count: Array.isArray(data) ? data.length : 'not-array', articles: data });
  } catch (e: any) {
    res.status(e?.status || 500).json({
      error: { code: e?.code || 'DEBUG_ARTICLES_FAILED', message_zh: e?.message || '未知错误' },
    });
  }
});

healthRouter.post('/debug/kb-search', requireSession, async (req, res): Promise<void> => {
  const { query, kbId, topK = 5 } = req.body ?? {};
  if (!query) {
    res.status(400).json({ error: { code: 'MISSING_QUERY', message_zh: '请提供 query' } });
    return;
  }
  try {
    const effectiveKbId = kbId ?? config.ai.kbId ?? (await resolveKbId(req.session!.accessToken, config.ithub.customerTag));
    if (!effectiveKbId) {
      res.status(404).json({ error: { code: 'NO_KB', message_zh: '未找到 KB' } });
      return;
    }
    const data = await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${effectiveKbId}/EmbeddingSearch`,
      {
        method: 'POST',
        accessToken: req.session!.accessToken,
        body: { Query: query, TopK: topK },
      },
    );
    res.json({ kbId: effectiveKbId, query, topK, result: data });
  } catch (e: any) {
    res.status(e?.status || 500).json({
      error: { code: e?.code || 'DEBUG_SEARCH_FAILED', message_zh: e?.message || '未知错误' },
    });
  }
});