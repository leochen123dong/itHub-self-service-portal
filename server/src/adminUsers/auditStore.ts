// In-memory audit log store.
//
// ITHub /api/Security/AuditLogs returns 404 (verified live), so all
// admin-side audit data lives here. Mirrors vipConfigStore pattern: in-memory
// Map/array, restart loses state, demo-scope only.
//
// API:
//   record(...) — append (with auto id/timestamp), seed mock on first use
//   list({userId, limit}) — recent events, optional user filter
//
// The UI flags the data as `degraded: true` so admins know it's not the real
// upstream record. When ITHub exposes a real audit endpoint, swap list()'
// implementation — the response shape stays identical.

export type AuditAction =
  | 'API_KEY_CREATED'
  | 'API_KEY_REVOKED'
  | 'PERMISSIONS_UPDATED'
  | 'USER_ACTIVATED'
  | 'USER_DEACTIVATED'
  | 'GROUP_CHANGED'
  | 'USER_CREATED'
  | 'PASSWORD_RESET_REQUESTED';

export interface AuditEvent {
  id: string;
  userId: number;
  action: AuditAction;
  actor: string;
  detail?: string;
  ts: number;
}

const events: AuditEvent[] = [];
let nextId = 0;

function seed(): void {
  if (events.length > 0) return;
  const now = Date.now();
  events.push(
    {
      id: `a${++nextId}`,
      userId: 138,
      action: 'PERMISSIONS_UPDATED',
      actor: 'demo.user',
      detail: 'set ALLOW_ALL',
      ts: now - 86400_000 * 3,
    },
    {
      id: `a${++nextId}`,
      userId: 96078,
      action: 'API_KEY_REVOKED',
      actor: 'demo.user',
      ts: now - 86400_000 * 2,
    },
    {
      id: `a${++nextId}`,
      userId: 97315,
      action: 'USER_ACTIVATED',
      actor: 'demo.user',
      ts: now - 3600_000 * 6,
    },
  );
}

export function record(e: Omit<AuditEvent, 'id' | 'ts'> & { ts?: number }): AuditEvent {
  seed();
  const ev: AuditEvent = {
    id: `a${++nextId}`,
    ts: e.ts ?? Date.now(),
    ...e,
  };
  events.unshift(ev); // newest first
  if (events.length > 500) events.pop();
  return ev;
}

export function list(filter: { userId?: number; limit?: number } = {}): AuditEvent[] {
  seed();
  let r = events;
  if (filter.userId) r = r.filter((e) => e.userId === filter.userId);
  return r.slice(0, filter.limit ?? 100);
}

export const AUDIT_DEGRADED_REASON = 'ITHub /api/Security/AuditLogs 不可用（404），使用本地内存记录';