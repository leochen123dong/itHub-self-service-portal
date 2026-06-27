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
  const blocks = picked
    .map((r, i) => {
      // Keep the full body — MiniMax-Text-01 has plenty of context room, and
      // specifics like server addresses / node names usually live deep in the
      // article. Truncating here was throwing away the answer.
      return `[${i + 1}] ${r.title}\n${r.body}`;
    })
    .join('\n\n');

  return `以下是企业内部知识库的检索结果。请严格遵守：

1. **只能使用下文中出现的事实**——服务器地址、URL、端口号、节点名、命令、步骤编号必须照搬原文，不要凭通用 IT 知识编造、改写或"补全"。
2. 如果用户问题在 KB 中找不到对应答案，明确告诉用户"知识库中没有找到 XX 的相关内容"，不要硬答。
3. 引用编号只用 [1]、[2] 这样的纯数字，文末不要再写引用说明段落。

---\n知识库内容：\n${blocks}`;
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

  const scored = list
    .map((r) => ({ article: r, score: scoreArticle(r, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Diagnostic: log which fields are actually populated so we can debug
  // why pickBody sometimes returns a near-empty string.
  console.log(`[kb] keyword tokens=${JSON.stringify(tokens)} picked=${scored.length}`);
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

/**
 * ITHub's /KnowledgeArticles endpoint defaults to a small page (10) which
 * drops recently added articles (e.g. K100071). Page through with pageSize=100
 * and dedupe by KnowledgeArticleId so we cover the whole KB.
 */
async function listAllArticles(accessToken: string, kbId: number): Promise<KbArticle[]> {
  const out: KbArticle[] = [];
  const seen = new Set<number>();
  const pageSize = 100;

  // Try a single call with pageSize=100 first — if ITHub honors it, we
  // avoid multiple round trips.
  for (let attempt = 0; attempt < 1; attempt++) {
    try {
      const raw = await ithubFetch<any>(
        `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
        { accessToken, query: { pageSize } },
      );
      const page: KbArticle[] = extractArticleList(raw);
      for (const a of page) {
        const id = pickId(a);
        if (typeof id === 'number' && !seen.has(id)) {
          seen.add(id);
          out.push(a);
        }
      }
      if (page.length < pageSize) {
        console.log(`[kb] listAllArticles got ${out.length} articles in one page (pageSize=${pageSize})`);
        return out;
      }
    } catch (err) {
      console.warn('[kb] paged KnowledgeArticles failed:', (err as Error).message);
      return out;
    }
  }

  // Page through if the first call returned a full page.
  let page = 1;
  while (page < 50) {
    try {
      const raw = await ithubFetch<any>(
        `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
        { accessToken, query: { pageSize, page } },
      );
      const list: KbArticle[] = extractArticleList(raw);
      if (list.length === 0) break;
      for (const a of list) {
        const id = pickId(a);
        if (typeof id === 'number' && !seen.has(id)) {
          seen.add(id);
          out.push(a);
        }
      }
      if (list.length < pageSize) break;
      page += 1;
    } catch (err) {
      console.warn(`[kb] KnowledgeArticles page=${page} failed:`, (err as Error).message);
      break;
    }
  }
  console.log(`[kb] listAllArticles returned ${out.length} unique articles across ${page} pages`);
  return out;
}

function extractArticleList(raw: any): KbArticle[] {
  if (Array.isArray(raw)) return raw;
  return (
    raw?.Results ?? raw?.results ?? raw?.Items ?? raw?.items ?? raw?.Data ?? raw?.Articles ?? []
  );
}