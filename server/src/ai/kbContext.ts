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
  return r.Name || r.Title || r.Identifier || '(无标题)';
}

function pickBody(r: KbSearchResult): string {
  // ITHub stores the long body in DescriptionText; keep fallbacks for variants.
  return r.Summary || r.DescriptionText || r.Description || r.Content || r.Body || '';
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
  const blocks = picked
    .map((r, i) => {
      const body = r.body.length > 400 ? r.body.slice(0, 400) + '…' : r.body;
      return `[${i + 1}] ${r.title}${body ? `\n${body}` : ''}`;
    })
    .join('\n\n');

  return `以下是企业内部知识库的检索结果，请优先基于这些内容回答。如果知识库没有覆盖，再用通用 IT 知识补充：\n\n${blocks}\n\n---\n请用中文回答，引用知识库内容时使用 [1]、[2] 这样的编号注明来源。`;
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

    const list: KbSearchResult[] = Array.isArray(raw)
      ? raw
      : raw?.Results ?? raw?.results ?? raw?.Items ?? raw?.items ?? raw?.Data ?? raw?.Articles ?? [];
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
  let raw: any;
  try {
    raw = await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
      { accessToken },
    );
  } catch (err) {
    console.warn('[kb] KnowledgeArticles list failed:', (err as Error).message);
    return [];
  }
  const list: KbArticle[] = Array.isArray(raw)
    ? raw
    : raw?.Results ?? raw?.results ?? raw?.Items ?? raw?.items ?? raw?.Data ?? raw?.Articles ?? [];
  if (!Array.isArray(list) || list.length === 0) {
    console.log(`[kb] KnowledgeArticles returned ${Array.isArray(list) ? list.length : 'non-array'}`);
    return [];
  }
  console.log(`[kb] keyword search over ${list.length} articles`);

  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const scored = list
    .map((r) => ({ article: r, score: scoreArticle(r, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Debug: log top scores so we can see which articles matched what.
  const debugTop = list
    .map((r) => ({ title: pickTitle(r), score: scoreArticle(r, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  console.log(`[kb] keyword tokens=${JSON.stringify(tokens)} topScores=${JSON.stringify(debugTop)}`);

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
  // Split on whitespace + Chinese punctuation; keep alphanumeric and CJK runs.
  const segments = text
    .replace(/[，。！？、；：""''《》【】()()\.,!?;:"'()\[\]]/g, ' ')
    .split(/\s+/)
    .flatMap((s) => s.match(/[A-Za-z0-9]+|[一-龥]+/g) ?? []);
  return segments.map((s) => s.toLowerCase()).filter((s) => s.length > 0 && !STOP_WORDS.has(s));
}

function scoreArticle(r: KbArticle, tokens: string[]): number {
  const title = (pickTitle(r) || '').toLowerCase();
  const summary = (r.Summary || '').toLowerCase();
  const body = (r.DescriptionText || r.Description || r.Content || r.Body || '').toLowerCase();
  if (!title && !body && !summary) return 0;

  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (title.includes(t)) score += 5;
    if (summary.includes(t)) score += 3;
    // Cap body hits so one huge article doesn't dominate
    const bodyHits = countOccurrences(body, t);
    if (bodyHits > 0) score += Math.min(bodyHits, 5);
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