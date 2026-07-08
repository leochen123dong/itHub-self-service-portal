// TTL cache mapping ITHub customerId → resolved VIP state + the group
// names that triggered the hit. Two reasons for the cache:
//   1. /Security/Users/{id} is one network call per ticket — list of 50
//      tickets must not mean 50 round-trips on every refresh.
//   2. The customer's own group membership rarely changes during a session,
//      so 5min staleness is acceptable for the demo.
//
// vipConfigStore.setVipGroupIds() must call clearCache() so that
// "admin re-flags groups" takes effect on the next list/detail fetch
// instead of waiting out the TTL.

type Resolved = {
  isVip: boolean;
  groups: string[];
  cachedAt: number;
};

const TTL = 5 * 60_000;
const cache = new Map<number, Resolved>();

export function getCached(customerId: number): Resolved | null {
  const hit = cache.get(customerId);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > TTL) {
    cache.delete(customerId);
    return null;
  }
  return hit;
}

export function setCache(customerId: number, r: Resolved): void {
  cache.set(customerId, r);
}

export function clearCache(): void {
  cache.clear();
}
