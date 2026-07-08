import { ithubFetch } from '../http/ithubClient.js';

// Known seed user IDs. Hard-coded for the demo so the admin UI is usable
// even when UserGroups doesn't return member lists. Real deployments should
// replace this with a CSV import or admin-maintained allowlist file.
const SEED_IDS = [138, 96078, 97315, 97213, 97301, 96084];

export interface DirectorySources {
  fromGroups: number;
  fromSeed: number;
  fromManual: number;
}

export interface DirectoryResult {
  ids: number[];
  sources: DirectorySources;
}

// Multi-strategy aggregation: groups ∪ seed ∪ manual.
//
// Why this shape: ITHub does NOT expose GET /api/Security/Users (returns 405),
// so we cannot enumerate the full user list. We piece together candidate IDs
// from three sources, dedupe, and let the caller fan-out to GET /Users/{id}
// for each one. The UI exposes a "paste IDs" input so an admin can supplement
// missing sources on the fly.
export async function listUserIds(opts: {
  accessToken: string;
  manualIds?: number[];
}): Promise<DirectoryResult> {
  const fromGroups = new Set<number>();

  try {
    const groups = await ithubFetch<any[]>('/api/Security/UserGroups', {
      accessToken: opts.accessToken,
    });
    for (const g of Array.isArray(groups) ? groups : []) {
      // ITHub has historically returned members under one of these names;
      // we try each so we don't break against older/newer payloads.
      const members: number[] = Array.isArray(g?.Members) ? g.Members
        : Array.isArray(g?.UserIds) ? g.UserIds
        : Array.isArray(g?.Users) ? g.Users.map((u: any) => Number(u?.UserId ?? u?.Id ?? 0)).filter(Boolean)
        : [];
      for (const m of members) {
        const n = Number(m);
        if (Number.isFinite(n) && n > 0) fromGroups.add(n);
      }
    }
  } catch {
    // UserGroups failed — fall through. We'll still return seed + manual.
  }

  const fromSeed = new Set<number>(SEED_IDS);
  const fromManual = new Set<number>((opts.manualIds ?? []).filter(Number.isFinite));

  const ids = [...new Set([...fromGroups, ...fromSeed, ...fromManual])]
    .sort((a, b) => a - b);

  return {
    ids,
    sources: {
      fromGroups: fromGroups.size,
      fromSeed: fromSeed.size,
      fromManual: fromManual.size,
    },
  };
}