// Per-article version counter. Bumps on either:
//   1. Successful local PUT via /kb/publish (after ITHub echoes ModifiedUtc back)
//   2. Detected external change via /kb/articles[/:id] GET — if ITHub returns
//      a different ModifiedUtc than what we last saw, the admin (or anyone
//      else) modified the article, so bump too.
//
// State is in-memory and resets on server restart. Acceptable for the demo:
// users see the counter grow during a session and rebuild on next publish.
// After restart, the next GET will see ModifiedUtc != null (we have nothing
// stored) and treat the article as "first sighting" → store without
// bumping, so no spurious v1 on boot.

const versions = new Map<number, number>();
const lastSeenModified = new Map<number, string>();

export function getVersion(articleId: number): number {
  return versions.get(articleId) ?? 0;
}

/**
 * Force-bump (e.g. after our own successful PUT). Optionally also records
 * the ITHub-returned ModifiedUtc so the next GET doesn't immediately
 * bump again thinking the admin changed something.
 */
export function bumpVersion(articleId: number, modifiedUtc?: string): number {
  const next = (versions.get(articleId) ?? 0) + 1;
  versions.set(articleId, next);
  if (modifiedUtc) lastSeenModified.set(articleId, modifiedUtc);
  return next;
}

/**
 * Observe an article on read. If its ModifiedUtc differs from the last
 * value we recorded, treat that as a remote change and bump. Returns the
 * resulting version so callers can attach it to the API response.
 *
 *   - First sighting, modifiedUtc provided  → store, return current (0)
 *   - Same modifiedUtc as last seen          → no-op
 *   - Different modifiedUtc                  → bump + record new value
 *   - modifiedUtc missing                   → no-op (can't detect)
 */
export function noteArticleSeen(articleId: number, modifiedUtc: string | undefined): number {
  if (!modifiedUtc) return versions.get(articleId) ?? 0;
  const prev = lastSeenModified.get(articleId);
  if (prev === undefined) {
    lastSeenModified.set(articleId, modifiedUtc);
    return versions.get(articleId) ?? 0;
  }
  if (prev === modifiedUtc) return versions.get(articleId) ?? 0;
  lastSeenModified.set(articleId, modifiedUtc);
  return bumpVersion(articleId, modifiedUtc);
}
