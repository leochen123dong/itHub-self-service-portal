// In-memory ring buffer of upstream ITHub calls.
//
// Captured automatically inside ithubFetch's finally block (after retry loop),
// so a single business call = one log entry regardless of how many internal
// retries happened. Caller identity is propagated via FetchOptions.
//
// ITHub does not expose a call-count / audit endpoint, so this is the only
// way to answer "what endpoints is this key actually being used for, and how
// often?" All data is in-memory — restart loses state. Matches the pattern
// in usageTracker.ts / auditStore.ts (demo scope only).
//
// Schema is metadata-only by design (per MVP plan): endpoint, method,
// statusCode, latency, identity, userId, auth mode. No request/response
// bodies — they may be large and sensitive.
//
// Capacity: MAX=5000 entries. New entries unshift to head; oldest dropped from
// tail when cap exceeded. Query/summary functions apply no further cap, so a
// generous `limit` argument is required to avoid returning huge payloads.

export type AuthMode = 'accessToken' | 'apiKey' | 'both' | 'none';

export interface ApiRequestLogEntry {
  ts: number;
  method: string;            // GET / POST / PUT / DELETE
  path: string;              // ITHub API path, e.g. '/api/Security/Users/138'
  statusCode: number;        // 200 / 401 / 408 / 500 / 0 (network)
  latencyMs: number;         // total elapsed (includes all retries)
  callerIdentity: string;   // req.session.identity, or 'anon'
  callerUserId: number;     // req.session.userId, or 0
  authMode: AuthMode;        // which credentials were sent
  attemptedRetries: number; // # of retries before success/final-fail
}

const MAX = 5000;
const entries: ApiRequestLogEntry[] = [];

export function record(entry: Omit<ApiRequestLogEntry, 'ts'>): void {
  entries.unshift({ ...entry, ts: Date.now() });
  if (entries.length > MAX) entries.pop();
}

export interface QueryOptions {
  userId?: number;
  sinceMs?: number;          // unix ms; only entries with ts >= sinceMs
  limit?: number;            // default 50, hard cap 500
  pathPrefix?: string;       // e.g. '/api/Security' to narrow scope
}

export function query(opts: QueryOptions = {}): ApiRequestLogEntry[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  let r = entries;
  if (opts.userId) r = r.filter((e) => e.callerUserId === opts.userId);
  if (opts.sinceMs !== undefined) {
    const since = opts.sinceMs;
    r = r.filter((e) => e.ts >= since);
  }
  if (opts.pathPrefix) {
    const pfx = opts.pathPrefix;
    r = r.filter((e) => e.path.startsWith(pfx));
  }
  return r.slice(0, limit);
}

export interface EndpointSummary {
  method: string;
  path: string;
  calls: number;
  errors: number;       // statusCode >= 400
  errorRate: number;    // errors / calls
  avgLatencyMs: number; // rounded
  p95LatencyMs: number; // rounded; for small N this collapses to max
  lastCalledAt: number;
}

function percentile95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank percentile with linear interpolation-free floor.
  // Index = ceil(0.95 * N) - 1, clamped to [0, N-1].
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[idx];
}

export function summaryByEndpoint(
  opts: { userId?: number; sinceMs?: number } = {},
): EndpointSummary[] {
  let r = entries;
  const { userId, sinceMs } = opts;
  if (userId !== undefined) r = r.filter((e) => e.callerUserId === userId);
  if (sinceMs !== undefined) r = r.filter((e) => e.ts >= sinceMs);

  const buckets = new Map<string, {
    method: string;
    path: string;
    latencies: number[];
    calls: number;
    errors: number;
    lastCalledAt: number;
  }>();

  for (const e of r) {
    const key = e.method + ' ' + e.path;
    const b = buckets.get(key) ?? {
      method: e.method,
      path: e.path,
      latencies: [],
      calls: 0,
      errors: 0,
      lastCalledAt: 0,
    };
    b.calls += 1;
    if (e.statusCode >= 400) b.errors += 1;
    b.latencies.push(e.latencyMs);
    if (e.ts > b.lastCalledAt) b.lastCalledAt = e.ts;
    buckets.set(key, b);
  }

  const out: EndpointSummary[] = [];
  for (const b of buckets.values()) {
    const sorted = b.latencies.slice().sort((a, c) => a - c);
    const sum = sorted.reduce((a, c) => a + c, 0);
    out.push({
      method: b.method,
      path: b.path,
      calls: b.calls,
      errors: b.errors,
      errorRate: b.calls === 0 ? 0 : b.errors / b.calls,
      avgLatencyMs: Math.round(sum / b.calls),
      p95LatencyMs: percentile95(sorted),
      lastCalledAt: b.lastCalledAt,
    });
  }
  // Most-called first.
  out.sort((a, b) => b.calls - a.calls);
  return out;
}

export interface IdentitySummary {
  callerIdentity: string;
  callerUserId: number;
  calls: number;
  errors: number;
  errorRate: number;
  lastCalledAt: number;
}

export function summaryByIdentity(
  opts: { sinceMs?: number } = {},
): IdentitySummary[] {
  let r = entries;
  const { sinceMs } = opts;
  if (sinceMs !== undefined) r = r.filter((e) => e.ts >= sinceMs);

  const buckets = new Map<string, {
    callerIdentity: string;
    callerUserId: number;
    calls: number;
    errors: number;
    lastCalledAt: number;
  }>();

  for (const e of r) {
    const key = e.callerUserId + ':' + e.callerIdentity;
    const b = buckets.get(key) ?? {
      callerIdentity: e.callerIdentity,
      callerUserId: e.callerUserId,
      calls: 0,
      errors: 0,
      lastCalledAt: 0,
    };
    b.calls += 1;
    if (e.statusCode >= 400) b.errors += 1;
    if (e.ts > b.lastCalledAt) b.lastCalledAt = e.ts;
    buckets.set(key, b);
  }

  const out: IdentitySummary[] = [];
  for (const b of buckets.values()) {
    out.push({
      callerIdentity: b.callerIdentity,
      callerUserId: b.callerUserId,
      calls: b.calls,
      errors: b.errors,
      errorRate: b.calls === 0 ? 0 : b.errors / b.calls,
      lastCalledAt: b.lastCalledAt,
    });
  }
  out.sort((a, b) => b.calls - a.calls);
  return out;
}

export interface GlobalSummary {
  totalCalls: number;
  totalErrors: number;
  errorRate: number;
  uniqueEndpoints: number;
  uniqueIdentities: number;
  windowMs: number;        // sinceMs -> now (for display)
}

export function globalSummary(opts: { sinceMs?: number } = {}): GlobalSummary {
  const now = Date.now();
  let r = entries;
  const { sinceMs } = opts;
  if (sinceMs !== undefined) r = r.filter((e) => e.ts >= sinceMs);
  const endpoints = new Set<string>();
  const identities = new Set<string>();
  let totalErrors = 0;
  for (const e of r) {
    endpoints.add(e.method + ' ' + e.path);
    identities.add(e.callerUserId + ':' + e.callerIdentity);
    if (e.statusCode >= 400) totalErrors += 1;
  }
  return {
    totalCalls: r.length,
    totalErrors,
    errorRate: r.length === 0 ? 0 : totalErrors / r.length,
    uniqueEndpoints: endpoints.size,
    uniqueIdentities: identities.size,
    windowMs: opts.sinceMs !== undefined ? now - opts.sinceMs : 0,
  };
}

// Used by tests / admin debug endpoint to force a clean state.
export function _resetForTests(): void {
  entries.length = 0;
}