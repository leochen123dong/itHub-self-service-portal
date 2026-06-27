import { ithubFetch } from '../http/ithubClient.js';
import { config } from '../config.js';
import { ITHubError } from '../http/errors.js';

interface KbSummary {
  KnowledgeBaseId?: number;
  Id?: number;
  Name?: string;
  Identifier?: string;
  Active?: boolean;
  IsActive?: boolean;
}

// Real ITHub article fields observed: KnowledgeArticleId, Name (title),
// Identifier, Summary, DescriptionText (the long body). Fallback field names
// are kept for forward-compat.
interface KbArticle {
  KnowledgeArticleId?: number;
  ArticleId?: number;
  Id?: number;
  Name?: string;
  Title?: string;
  Identifier?: string;
  DescriptionText?: string;
  Description?: string;
  Content?: string;
  Body?: string;
  Summary?: string;
  Score?: number;
  RelevanceScore?: number;
}

type KbSearchResult = KbArticle;

const kbIdCache = new Map<string, { id: number; fetchedAt: number }>();
const KB_ID_TTL_MS = 30 * 60 * 1000;

/**
 * Resolve the KB ID to use: env override first, otherwise auto-discover via
 * ITHub /api/Knowledge/KnowledgeBases using the user's access token. Cached
 * per-customerTag for 30min so repeated discovery calls are avoided.
 */
export async function resolveKbId(accessToken: string, customerTag: string): Promise<number | null> {
  if (config.ai.kbId) return parseInt(config.ai.kbId, 10);

  const cached = kbIdCache.get(customerTag);
  if (cached && Date.now() - cached.fetchedAt < KB_ID_TTL_MS) return cached.id;

  try {
    const kbs = await ithubFetch<KbSummary[]>('/api/Knowledge/KnowledgeBases', { accessToken });
    if (!Array.isArray(kbs) || kbs.length === 0) return null;
    const pickId = (k: KbSummary) => k.KnowledgeBaseId ?? k.Id;
    const active = kbs.find((k) => (k.Active !== false && k.IsActive !== false) && pickId(k) !== undefined);
    const chosen = active ?? kbs.find((k) => pickId(k) !== undefined);
    const id = chosen ? pickId(chosen) : undefined;
    if (typeof id !== 'number') return null;
    kbIdCache.set(customerTag, { id, fetchedAt: Date.now() });
    return id;
  } catch {
    return null;
  }
}

function pickId(r: KbSearchResult): number | undefined {
  return r.KnowledgeArticleId ?? r.ArticleId ?? r.Id;
}

function pickTitle(r: KbSearchResult): string {
  // In the list endpoint, Name/Identifier are the article ID (e.g. "K100070"),
  // not a human title. Summary is the real caption — use it as the title
  // for the prompt and leave ID lookups to pickId().
  if (r.Summary && r.Summary.trim()) return r.Summary.trim();
  if (r.Title && r.Title.trim()) return r.Title.trim();
  return '(无标题)';
}

function pickBody(r: KbSearchResult): string {
  // DescriptionText is the real body (often >1KB). Summary is usually a
  // 1-line caption and must NOT shadow it via ||.
  if (r.DescriptionText) return r.DescriptionText;
  if (r.Description) return r.Description;
  if (r.Content) return r.Content;
  if (r.Body) return r.Body;
  return r.Summary || '';
}

/**
 * Search the KB for the query and return a formatted context block suitable
 * to inject as a system message. Empty string if no results or on failure.
 *
 * Strategy:
 *  1. Try EmbeddingSearch with several payload shapes (PascalCase, camelCase,
 *     snake_case) — different ITHub tenants expose different field names.
 *  2. If that returns nothing, fall back to listing all KnowledgeArticles in
 *     the KB and doing client-side keyword scoring. Slower, but always works
 *     when the vector endpoint is unavailable or not yet indexed.
 */
export async function buildKbContext(
  accessToken: string,
  query: string,
  topK = 3,
): Promise<string> {
  if (!query || !query.trim()) {
    console.log('[kb] empty query, skip');
    return '';
  }
  const customerTag = config.ithub.customerTag;
  const kbId = await resolveKbId(accessToken, customerTag);
  if (!kbId) {
    console.warn(`[kb] no KB available for customerTag=${customerTag}`);
    return '';
  }
  console.log(`[kb] querying kbId=${kbId} query="${query.slice(0, 60)}"`);

  const embeddingResults = await tryEmbeddingSearch(accessToken, kbId, query, topK);
  let picked: Array<{ id: number | undefined; title: string; body: string; score?: number }> =
    embeddingResults;

  if (!picked.length) {
    console.log('[kb] EmbeddingSearch returned nothing, falling back to keyword search');
    picked = await keywordSearch(accessToken, kbId, query, topK);
  }
  if (!picked.length) return '';

  console.log(`[kb] picked ${picked.length} articles with content`);
  // Hard cap on the injected context so MiniMax doesn't reject with
  // "context window exceeds limit" (status_code 2013). Empirically ~2MB of
  // KB text saturates the model; we keep a generous budget for actual answer
  // room (response budget ~ max_tokens 1024 ≈ 2-4KB Chinese).
  const PER_ARTICLE_MAX = 1500;
  const TOTAL_MAX = 6000;
  const blocks: string[] = [];
  let totalLen = 0;
  for (let i = 0; i < picked.length; i += 1) {
    const r = picked[i];
    const body = r.body.length > PER_ARTICLE_MAX
      ? r.body.slice(0, PER_ARTICLE_MAX) + '\n…(已截断)'
      : r.body;
    const block = `[${i + 1}] ${r.title}\n${body}`;
    if (totalLen + block.length > TOTAL_MAX) {
      console.warn(`[kb] context budget hit at article ${i + 1}/${picked.length}; truncating`);
      break;
    }
    blocks.push(block);
    totalLen += block.length;
  }

  return `以下是企业内部知识库的检索结果。请严格遵守：

1. **只能使用下文中出现的事实**——服务器地址、URL、端口号、节点名、命令、步骤编号必须照搬原文，不要凭通用 IT 知识编造、改写或"补全"。
2. 如果用户问题在 KB 中找不到对应答案，明确告诉用户"知识库中没有找到 XX 的相关内容"，不要硬答。
3. 引用编号只用 [1]、[2] 这样的纯数字，文末不要再写引用说明段落。

---\n知识库内容：\n${blocks.join('\n\n')}`;
}

async function tryEmbeddingSearch(
  accessToken: string,
  kbId: number,
  query: string,
  topK: number,
): Promise<Array<{ id: number | undefined; title: string; body: string; score?: number }>> {
  const payloads = [
    { Query: query.trim(), TopK: topK },
    { query: query.trim(), topK: topK },
    { query: query.trim(), top_k: topK },
    { Query: query.trim(), TopK: topK, UseSemantic: true },
  ];

  for (const body of payloads) {
    let raw: any;
    try {
      raw = await ithubFetch<any>(
        `/api/Knowledge/KnowledgeBases/${kbId}/EmbeddingSearch`,
        { method: 'POST', accessToken, body },
      );
    } catch (err) {
      if (err instanceof ITHubError && err.status === 404) {
        console.warn(`[kb] kbId=${kbId} not found or has no embeddings`);
        return [];
      }
      console.warn('[kb] EmbeddingSearch failed:', (err as Error).message);
      continue;
    }
    const sample = (typeof raw === 'string' ? raw : JSON.stringify(raw ?? null) || '').slice(0, 200);
    console.log(`[kb] EmbeddingSearch payload=${JSON.stringify(body)} raw: ${sample}`);

    const list = extractArticleList(raw);
    if (!Array.isArray(list) || list.length === 0) continue;

    return list
      .map((r) => ({
        id: pickId(r),
        title: pickTitle(r),
        body: pickBody(r),
        score: r.Score ?? r.RelevanceScore,
      }))
      .filter((r) => r.body || r.title)
      .slice(0, topK);
  }
  return [];
}

async function keywordSearch(
  accessToken: string,
  kbId: number,
  query: string,
  topK: number,
): Promise<Array<{ id: number | undefined; title: string; body: string; score?: number }>> {
  const list = await listAllArticles(accessToken, kbId);
  if (list.length === 0) {
    console.log('[kb] KnowledgeArticles returned 0 articles');
    return [];
  }
  console.log(`[kb] keyword search over ${list.length} articles`);

  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const allScored = list
    .map((r) => ({ article: r, score: scoreArticle(r, tokens) }))
    .sort((a, b) => b.score - a.score);

  const candidates = allScored.filter((s) => s.score > 0).slice(0, topK);

  // Diagnostic: log which fields are actually populated so we can debug
  // why pickBody sometimes returns a near-empty string.
  console.log(
    `[kb] keyword tokens=${JSON.stringify(tokens)} ` +
    `candidates=${candidates.length} ` +
    `topScores=${JSON.stringify(allScored.slice(0, 5).map((s) => ({ id: pickId(s.article), title: pickTitle(s.article), score: s.score, summaryLen: (s.article.Summary || '').length })))}`,
  );

  // The list endpoint returns summaries without bodies — fetch full content
  // for each candidate via /KnowledgeArticles/:id.
  const scored: Array<{ article: KbArticle; score: number }> = [];
  for (const c of candidates) {
    const id = pickId(c.article);
    if (typeof id !== 'number') continue;
    const full = await fetchArticleBody(accessToken, id, c.article);
    scored.push({ article: full, score: c.score });
  }
  if (scored.length > 0) {
    const sample = scored[0].article;
    console.log(
      `[kb] topArticle keys=${Object.keys(sample).join(',')} ` +
      `name="${pickTitle(sample)}" ` +
      `summaryLen=${(sample.Summary || '').length} ` +
      `descTextLen=${(sample.DescriptionText || '').length} ` +
      `descLen=${(sample.Description || '').length} ` +
      `bodyLen=${(sample.Body || '').length}`,
    );
  }

  return scored.map(({ article, score }) => ({
    id: pickId(article),
    title: pickTitle(article),
    body: pickBody(article),
    score,
  }));
}

const STOP_WORDS = new Set([
  '的', '了', '和', '是', '在', '我', '有', '不', '这', '也', '就', '都', '吗',
  '怎么', '如何', '什么', '一个', '一下', '上', '下', '中', '到', '为', '与',
  '或', '及', '之', '请', '帮', '我', '你', '他', '她', '它', '把', '被',
]);

function tokenize(text: string): string[] {
  // CJK substring search: emit every adjacent 2-character pair from each
  // Chinese run, plus any alphanumeric tokens. Per-character 1-grams are
  // intentionally omitted — single characters are too generic and would
  // cause cross-talk (e.g. "如" matching many articles).
  const segments = text
    .replace(/[，。！？、；：""''《》【】()()\.,!?;:"'()\[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const seg of segments) {
    const alphanumeric = seg.match(/[A-Za-z0-9]+/g);
    if (alphanumeric) out.push(...alphanumeric);
    const cjk = seg.match(/[一-龥]/g);
    if (cjk && cjk.length >= 2) {
      for (let i = 0; i < cjk.length - 1; i += 1) {
        out.push(cjk[i] + cjk[i + 1]);
      }
    } else if (cjk && cjk.length === 1) {
      // Single CJK character — keep it but with reduced weight downstream.
      out.push(cjk[0]);
    }
  }
  return out
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 0 && !STOP_WORDS.has(s));
}

function scoreArticle(r: KbArticle, tokens: string[]): number {
  const title = (pickTitle(r) || '').toLowerCase();
  const summary = (r.Summary || '').toLowerCase();
  const body = (r.DescriptionText || r.Description || r.Content || r.Body || '').toLowerCase();
  if (!title && !body && !summary) return 0;

  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    const isSingleChar = t.length === 1;
    const titleW = isSingleChar ? 1 : 8;
    const summaryW = isSingleChar ? 1 : 4;
    const bodyW = isSingleChar ? 0 : 1;
    if (title.includes(t)) score += titleW;
    if (summary.includes(t)) score += summaryW;
    if (bodyW > 0) {
      const bodyHits = countOccurrences(body, t);
      if (bodyHits > 0) score += Math.min(bodyHits, 5) * bodyW;
    }
  }
  return score;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
    if (count > 100) break;
  }
  return count;
}

/**
 * ITHub's /KnowledgeBases/{kbId}/KnowledgeArticles defaults to a small page
 * (10) and ignores pageSize params. But the top-level
 * /KnowledgeArticles?KnowledgeBaseId={kbId} returns the full list (verified:
 * 21 articles including the newest K100071). Use that as the primary path.
 */
async function listAllArticles(accessToken: string, kbId: number): Promise<KbArticle[]> {
  // Primary: top-level listing, no page cap.
  try {
    const raw = await ithubFetch<any>(`/api/Knowledge/KnowledgeArticles`, {
      accessToken,
      query: { KnowledgeBaseId: kbId },
    });
    const list = extractArticleList(raw);
    if (list.length > 0) {
      console.log(`[kb] listAllArticles via top-level: ${list.length} articles`);
      return list;
    }
  } catch (err) {
    console.warn('[kb] top-level KnowledgeArticles failed:', (err as Error).message);
  }

  // Fallback: nested path, returns only the default top-10. Better than nothing.
  try {
    const raw = await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
      { accessToken },
    );
    const list = extractArticleList(raw);
    console.log(`[kb] listAllArticles via nested path (fallback, capped): ${list.length} articles`);
    return list;
  } catch (err) {
    console.warn('[kb] nested KnowledgeArticles failed:', (err as Error).message);
    return [];
  }
}

function extractArticleList(raw: any): KbArticle[] {
  if (Array.isArray(raw)) return raw;
  return (
    raw?.Results ?? raw?.results ?? raw?.Items ?? raw?.items ?? raw?.Data ?? raw?.Articles ?? []
  );
}

async function fetchArticleBody(
  accessToken: string,
  articleId: number,
  fallback: KbArticle,
): Promise<KbArticle> {
  try {
    const data = await ithubFetch<any>(`/api/Knowledge/KnowledgeArticles/${articleId}`, {
      accessToken,
    });
    if (data && typeof data === 'object') {
      return { ...fallback, ...data };
    }
  } catch (err) {
    console.warn(`[kb] fetchArticleBody ${articleId} failed:`, (err as Error).message);
  }
  return fallback;
}