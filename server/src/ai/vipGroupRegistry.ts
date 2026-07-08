// Registry of ITHub user groups we've actually observed via
// /Security/Users/{id} lookups. The admin UI uses this as its checkbox
// list — so by construction every choice corresponds to a real group
// attached to a real customer.
//
// Why we don't just hit /api/Security/UserGroups: that endpoint is POST
// only (Allow: POST) and we can't probe its body shape without live
// AccessToken credentials. Discovering through ticket customers is
// strictly more demo-friendly — no separate API call surface to maintain.
//
// Keyed by UserGroupId. Name is cached because ITHub can return the
// same id with display strings that vary between Customers / Tenants;
// we keep the first non-empty value we see.

type ObservedGroup = {
  UserGroupId: number;
  Name: string;
};

const registry = new Map<number, ObservedGroup>();

export function recordGroups(
  raw: Array<{ UserGroupId?: number; Id?: number; Name?: string; DisplayName?: string }>,
): void {
  if (!Array.isArray(raw)) return;
  for (const g of raw) {
    const id = Number(g?.UserGroupId ?? g?.Id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const name = String(g?.Name ?? g?.DisplayName ?? '').trim();
    const existing = registry.get(id);
    if (existing) {
      // Backfill name if the first sighting had no label.
      if (!existing.Name && name) existing.Name = name;
      continue;
    }
    registry.set(id, { UserGroupId: id, Name: name || `用户组 #${id}` });
  }
}

export function getObservedGroups(): ObservedGroup[] {
  return [...registry.values()].sort((a, b) =>
    a.Name.localeCompare(b.Name, 'zh'),
  );
}

export function clearRegistry(): void {
  registry.clear();
}
