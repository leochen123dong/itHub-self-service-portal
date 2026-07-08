// Set of ITHub UserGroupIds that the portal admin has flagged as VIP.
// Tickets created by users whose UserGroups intersect this set are
// flagged IsVip=true in the ticket list / detail responses.
//
// In-memory on purpose: matches the kbVersionStore / kbUsageStore pattern.
// Resets on server restart. Render restart = admin re-flags via /admin/vip.
// If we need durability later, hydrate from a JSON in server/.env.

const vipGroupIds = new Set<number>();

export function getVipGroupIds(): number[] {
  return [...vipGroupIds];
}

export function setVipGroupIds(ids: number[]): void {
  vipGroupIds.clear();
  for (const id of ids ?? []) {
    const n = Number(id);
    if (Number.isFinite(n)) vipGroupIds.add(n);
  }
}

export function isVipGroup(groupId: number): boolean {
  return vipGroupIds.has(groupId);
}
