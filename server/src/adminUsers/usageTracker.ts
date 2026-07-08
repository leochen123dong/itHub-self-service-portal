// In-memory usage tracker.
//
// ITHub does not expose a call-count / latency / error-rate endpoint, so all
// usage data is local. The admin POST /api/admin-users/usage/log endpoint
// lets an external script (or the admin UI itself) push records in.
//
// API:
//   record(...) — append a single call
//   summary(userId?) — aggregate by userId (or all users)
//
// Mirrors vipConfigStore pattern: in-memory, restart loses state, demo-scope
// only.

export interface CallRecord {
  userId: number;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  ts: number;
}

export interface UsageRow {
  userId: number;
  calls: number;
  errors: number;
  errorRate: number;
  lastActiveAt: number;
}

export interface UsageSummary {
  rows: UsageRow[];
  totals: { calls: number; errors: number; errorRate: number };
}

const calls: CallRecord[] = [];
const MAX = 5000;

export function record(c: Omit<CallRecord, 'ts'>): void {
  calls.push({ ...c, ts: Date.now() });
  if (calls.length > MAX) calls.shift();
}

export function summary(userId?: number): UsageSummary {
  const filtered = userId ? calls.filter((c) => c.userId === userId) : calls;

  const byUser = new Map<number, { calls: number; errors: number; lastActiveAt: number }>();
  for (const c of filtered) {
    const cur = byUser.get(c.userId) ?? { calls: 0, errors: 0, lastActiveAt: 0 };
    cur.calls += 1;
    if (c.statusCode >= 400) cur.errors += 1;
    cur.lastActiveAt = Math.max(cur.lastActiveAt, c.ts);
    byUser.set(c.userId, cur);
  }

  const rows: UsageRow[] = [...byUser.entries()].map(([uid, s]) => ({
    userId: uid,
    ...s,
    errorRate: s.calls === 0 ? 0 : s.errors / s.calls,
  }));

  rows.sort((a, b) => b.calls - a.calls);

  const totalCalls = rows.reduce((a, b) => a + b.calls, 0);
  const totalErrors = rows.reduce((a, b) => a + b.errors, 0);

  return {
    rows,
    totals: {
      calls: totalCalls,
      errors: totalErrors,
      errorRate: totalCalls === 0 ? 0 : totalErrors / totalCalls,
    },
  };
}