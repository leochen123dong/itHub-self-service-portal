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

healthRouter.get('/debug/kb/:id/categories', requireSession, async (req, res): Promise<void> => {
  try {
    const kbId = parseInt(req.params.id, 10);
    const data = await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticleCategories`,
      { accessToken: req.session!.accessToken },
    );
    res.json({ kbId, count: Array.isArray(data) ? data.length : 'not-array', categories: data });
  } catch (e: any) {
    res.status(e?.status || 500).json({
      error: { code: e?.code || 'DEBUG_CATEGORIES_FAILED', message_zh: e?.message || '未知错误' },
    });
  }
});

// Probe which pagination / query convention ITHub honors for /KnowledgeArticles.
// Tries common conventions and reports which one returned more than 10 items.
healthRouter.get('/debug/kb/:id/probe-paging', requireSession, async (req, res): Promise<void> => {
  const kbId = parseInt(req.params.id, 10);
  const token = req.session!.accessToken;
  const variants: Array<{ name: string; query: Record<string, string | number> }> = [
    { name: 'pageSize=100', query: { pageSize: 100 } },
    { name: 'PageSize=100', query: { PageSize: 100 } },
    { name: '$top=100', query: { $top: 100 } },
    { name: 'top=100', query: { top: 100 } },
    { name: 'limit=100', query: { limit: 100 } },
    { name: 'pagesize=100', query: { pagesize: 100 } },
    { name: 'count=100', query: { count: 100 } },
  ];
  const out: Array<{ name: string; count: number | string; firstId?: number; lastId?: number; error?: string }> = [];
  for (const v of variants) {
    try {
      const data = await ithubFetch<any>(
        `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
        { accessToken: token, query: v.query },
      );
      const list: any[] = Array.isArray(data)
        ? data
        : data?.Results ?? data?.results ?? data?.Items ?? data?.items ?? data?.Data ?? data?.Articles ?? [];
      out.push({
        name: v.name,
        count: list.length,
        firstId: list[0]?.KnowledgeArticleId,
        lastId: list[list.length - 1]?.KnowledgeArticleId,
      });
    } catch (e: any) {
      out.push({ name: v.name, count: 'err', error: e?.message });
    }
  }
  res.json({ kbId, variants: out });
});

healthRouter.get('/debug/kb/:id/all-articles', requireSession, async (req, res): Promise<void> => {
  try {
    const kbId = parseInt(req.params.id, 10);
    const data = await ithubFetch<any>(`/api/Knowledge/KnowledgeArticles`, {
      accessToken: req.session!.accessToken,
      query: { KnowledgeBaseId: kbId },
    });
    const list: any[] = Array.isArray(data)
      ? data
      : data?.Results ?? data?.results ?? data?.Items ?? data?.items ?? data?.Data ?? data?.Articles ?? [];
    res.json({
      kbId,
      count: list.length,
      articles: list.map((a: any) => ({
        KnowledgeArticleId: a.KnowledgeArticleId ?? a.Id,
        Identifier: a.Identifier,
        CustomerTag: a.CustomerTag,
        CustomerId: a.CustomerId,
        Summary: a.Summary,
        KnowledgeCategoryId: a.KnowledgeCategoryId,
        KnowledgeCategoryName: a.KnowledgeCategoryName,
        DescriptionTextLen: (a.DescriptionText || '').length,
      })),
    });
  } catch (e: any) {
    res.status(e?.status || 500).json({
      error: { code: e?.code || 'DEBUG_ALL_FAILED', message_zh: e?.message || '未知错误' },
    });
  }
});

// Probe alternate paths that might return more than the default page.
healthRouter.get('/debug/kb/:id/probe-paths', requireSession, async (req, res): Promise<void> => {
  const kbId = parseInt(req.params.id, 10);
  const token = req.session!.accessToken;
  const paths: Array<{ name: string; path: string; query?: Record<string, string | number>; method?: 'GET' | 'POST' }> = [
    { name: 'top-level', path: '/api/Knowledge/KnowledgeArticles', query: { KnowledgeBaseId: kbId } },
    { name: 'top-level-topkb', path: '/api/Knowledge/KnowledgeArticles', query: { knowledgeBaseId: kbId } },
    { name: 'top-level-search', path: '/api/Knowledge/KnowledgeArticles/Search', method: 'POST' },
    { name: 'base-no-slash', path: `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles` },
    { name: 'by-knowledgebase', path: `/api/Knowledge/KnowledgeArticles/ByKnowledgeBase/${kbId}` },
    { name: 'article-detail-100071', path: '/api/Knowledge/KnowledgeArticles/100071' },
  ];
  const out: Array<{ name: string; status: number; count: number | string; firstId?: number; lastId?: number; error?: string }> = [];
  for (const p of paths) {
    try {
      const data = await ithubFetch<any>(p.path, {
        accessToken: token,
        method: p.method ?? 'GET',
        query: p.query,
        body: p.method === 'POST' ? { KnowledgeBaseId: kbId, TopK: 100 } : undefined,
      });
      const list: any[] = Array.isArray(data)
        ? data
        : data?.Results ?? data?.results ?? data?.Items ?? data?.items ?? data?.Data ?? data?.Articles ?? [];
      out.push({
        name: p.name,
        status: 200,
        count: list.length,
        firstId: list[0]?.KnowledgeArticleId,
        lastId: list[list.length - 1]?.KnowledgeArticleId,
      });
    } catch (e: any) {
      out.push({ name: p.name, status: e?.status || 0, count: 'err', error: e?.message });
    }
  }
  res.json({ kbId, paths: out });
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