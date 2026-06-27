import { ithubFetch } from '../http/ithubClient.js';
import { config } from '../config.js';
import { ITHubError } from '../http/errors.js';

interface KbSummary {
  KnowledgeBaseId?: number;
  Id?: number;
  Name?: string;
  Active?: boolean;
  IsActive?: boolean;
}

interface KbSearchResult {
  // Common shapes — handle both ITHub's native and OData-ish responses
  KnowledgeArticleId?: number;
  ArticleId?: number;
  Id?: number;
  Name?: string;
  Title?: string;
  Description?: string;
  Content?: string;
  Body?: string;
  Summary?: string;
  Score?: number;
  RelevanceScore?: number;
}

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
  return r.Title || r.Name || '(无标题)';
}

function pickBody(r: KbSearchResult): string {
  // Prefer short body fields to keep the prompt compact; fall back to longer ones.
  return r.Summary || r.Description || r.Content || r.Body || '';
}

/**
 * Search the KB for the query and return a formatted context block suitable
 * to inject as a system message. Empty string if no results or on failure.
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

  let raw: any;
  try {
    raw = await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${kbId}/EmbeddingSearch`,
      {
        method: 'POST',
        accessToken,
        body: { Query: query.trim(), TopK: topK },
      },
    );
  } catch (err) {
    if (!(err instanceof ITHubError) || err.status !== 404) {
      console.warn('[kb] EmbeddingSearch failed:', (err as Error).message);
    } else {
      console.warn(`[kb] kbId=${kbId} not found or has no embeddings`);
    }
    return '';
  }

  // Log the raw response shape so we can see what ITHub actually returns
  const rawStringified = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
  const rawSample = rawStringified.slice(0, 200);
  console.log(`[kb] EmbeddingSearch raw: ${rawSample}`);

  const list: KbSearchResult[] = Array.isArray(raw)
    ? raw
    : raw?.Results ?? raw?.results ?? raw?.Items ?? raw?.items ?? raw?.Data ?? raw?.Articles ?? [];
  console.log(`[kb] parsed ${Array.isArray(list) ? list.length : 'non-array'} results`);
  if (!Array.isArray(list) || list.length === 0) return '';

  const picked = list
    .map((r) => ({
      id: pickId(r),
      title: pickTitle(r),
      body: pickBody(r),
      score: r.Score ?? r.RelevanceScore,
    }))
    .filter((r) => r.body || r.title)
    .slice(0, topK);
  console.log(`[kb] picked ${picked.length} articles with content`);
  if (!picked.length) return '';

  const blocks = picked
    .map((r, i) => {
      const body = r.body.length > 400 ? r.body.slice(0, 400) + '…' : r.body;
      return `[${i + 1}] ${r.title}${body ? `\n${body}` : ''}`;
    })
    .join('\n\n');

  return `以下是企业内部知识库的检索结果，请优先基于这些内容回答。如果知识库没有覆盖，再用通用 IT 知识补充：\n\n${blocks}\n\n---\n请用中文回答，引用知识库内容时使用 [1]、[2] 这样的编号注明来源。`;
}