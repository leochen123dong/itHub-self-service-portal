import { listAllArticles, resolveKbId } from './kbContext.js';
import { config } from '../config.js';

export interface KbRef {
  id: number;
  title: string;
}

export interface KbUsageRecord {
  articleId: number;
  title: string;
  useCount: number;
  lastUsedAt: number;
}

export interface KbUsageStats {
  ranking: KbUsageRecord[];
  unused: Array<{ id: number; title: string }>;
  totalKbArticles: number;
}

// In-memory counter. Each (chatId, msgIndex) KB-hit increments useCount by 1.
// Reset on process restart — same lifecycle as chatStore / ratingStore.
const usage = new Map<number, KbUsageRecord>();

export function recordKbUsage(refs: KbRef[]): void {
  if (!refs || refs.length === 0) return;
  const now = Date.now();
  for (const r of refs) {
    const existing = usage.get(r.id);
    if (existing) {
      existing.useCount += 1;
      existing.lastUsedAt = now;
      if (r.title && (!existing.title || existing.title === '(无标题)')) {
        existing.title = r.title;
      }
    } else {
      usage.set(r.id, {
        articleId: r.id,
        title: r.title || '(无标题)',
        useCount: 1,
        lastUsedAt: now,
      });
    }
  }
}

export function getKbUsageRanking(limit = 10): KbUsageRecord[] {
  return Array.from(usage.values())
    .sort((a, b) => b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt)
    .slice(0, limit);
}

function pickId(raw: any): number | undefined {
  return raw?.KnowledgeArticleId ?? raw?.ArticleId ?? raw?.Id;
}

function pickTitle(raw: any): string {
  if (raw?.Summary && String(raw.Summary).trim()) return String(raw.Summary).trim();
  if (raw?.Title && String(raw.Title).trim()) return String(raw.Title).trim();
  return '(无标题)';
}

/**
 * Compute the unused-articles list by listing every article in the tenant KB
 * and diffing against the in-memory `usage` map. Articles that have been
 * used at least once are excluded. Articles ITHub returns without a numeric
 * id are skipped — admin views need stable keys.
 */
export async function getUnusedKbArticles(
  accessToken: string,
): Promise<Array<{ id: number; title: string }>> {
  const kbId = await resolveKbId(accessToken, config.ithub.customerTag);
  if (!kbId) return [];
  const all = await listAllArticles(accessToken, kbId);
  const unused: Array<{ id: number; title: string }> = [];
  for (const a of all) {
    const id = pickId(a);
    if (typeof id !== 'number') continue;
    if (usage.has(id)) continue;
    unused.push({ id, title: pickTitle(a) });
  }
  // Stable display order: by id ascending so admins can scan quickly.
  unused.sort((a, b) => a.id - b.id);
  return unused;
}

export async function getKbUsageStats(accessToken: string): Promise<KbUsageStats> {
  const ranking = getKbUsageRanking(10);
  const unused = await getUnusedKbArticles(accessToken);
  return {
    ranking,
    unused,
    totalKbArticles: ranking.length + unused.length,
  };
}