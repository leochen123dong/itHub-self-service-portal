// TTL cache mapping ITHub userId → full ITHub user object.
//
// Mirrors vipCache.ts structure. Reason for the cache:
//   1. /Security/Users/{id} is one network call per row. Loading a directory
//      of N users must not mean N round-trips on every refresh.
//   2. User fields change rarely during a session, so 5min staleness is
//      acceptable for the demo.
//
// Any write operation (api-key create/revoke, permissions update, lifecycle
// change) MUST call invalidate(id) so admin re-fetch sees fresh data instead
// of waiting out the TTL.

type CachedUser = {
  user: unknown;
  fetchedAt: number;
};

const TTL = 5 * 60_000;
const cache = new Map<number, CachedUser>();

export function getCached(userId: number): unknown | null {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > TTL) {
    cache.delete(userId);
    return null;
  }
  return hit.user;
}

export function setCached(userId: number, user: unknown): void {
  cache.set(userId, { user, fetchedAt: Date.now() });
}

export function invalidate(userId: number): void {
  cache.delete(userId);
}

export function clearAll(): void {
  cache.clear();
}