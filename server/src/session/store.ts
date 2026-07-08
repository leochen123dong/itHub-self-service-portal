import { nanoid } from 'nanoid';
import { config } from '../config.js';

export interface SessionData {
  accessToken: string;
  userId: number;
  userName: string;
  identity: string;
  customerTag: string;
  createdAt: number;
  expiresAt: number;
}

const store = new Map<string, SessionData>();

// Per-session refresh lock so the cache populates exactly once when
// multiple concurrent calls hit a dead token at the same time.
const refreshInFlight = new Map<string, Promise<void>>();

export function createSession(data: Omit<SessionData, 'createdAt' | 'expiresAt'>): string {
  const sid = nanoid(24);
  const now = Date.now();
  store.set(sid, {
    ...data,
    createdAt: now,
    expiresAt: now + config.session.ttlHours * 3600_000,
  });
  return sid;
}

export function getSession(sid: string | undefined): SessionData | undefined {
  if (!sid) return undefined;
  const s = store.get(sid);
  if (!s) return undefined;
  if (s.expiresAt < Date.now()) {
    store.delete(sid);
    return undefined;
  }
  return s;
}

export function deleteSession(sid: string | undefined) {
  if (sid) {
    store.delete(sid);
    refreshInFlight.delete(sid);
  }
}

export function purgeExpired() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}

// Periodically purge
setInterval(purgeExpired, 5 * 60_000).unref?.();

/**
 * Refresh the AccessToken in a session by re-logging-in against ITHub using
 * the configured demo credentials (ITHUB_DEMO_IDENTITY / ITHUB_DEMO_PASSWORD
 * in server/.env). Used when an upstream ITHub call returns 401 and we
 * suspect the user's token has expired on ITHub's side but our backend
 * session is still within TTL.
 *
 * Returns true on success (session updated in-place), false otherwise.
 * Idempotent: concurrent calls for the same session share one refresh.
 *
 * NOTE: This only works if the session's identity matches the configured
 * demo identity. For a true multi-tenant prod deployment this would not be
 * sufficient — the password would need to be stored encrypted per session.
 */
export async function refreshSessionAccessToken(sid: string): Promise<boolean> {
  const session = store.get(sid);
  if (!session) return false;

  const demoId = config.ithub.demoIdentity;
  const demoPwd = config.ithub.demoPassword;
  if (!demoId || !demoPwd) return false;
  // Safety: only refresh if the session identity matches the configured demo
  // account. Otherwise we'd silently re-login as someone else.
  if (session.identity !== demoId) return false;

  // Coalesce concurrent refresh attempts.
  const inflight = refreshInFlight.get(sid);
  if (inflight) {
    await inflight;
    return !!store.get(sid)?.accessToken;
  }

  const promise = (async () => {
    try {
      const res = await fetch(
        `${config.ithub.baseUrl}/api/Security/AccessTokens`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            Identity: demoId,
            Password: demoPwd,
          }),
        },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        AccessToken?: string;
        UserId?: number;
        UserName?: string;
        CustomerTag?: string;
      };
      if (!data.AccessToken) return;
      const s = store.get(sid);
      if (!s) return;
      s.accessToken = data.AccessToken;
      if (data.UserId) s.userId = data.UserId;
      if (data.UserName) s.userName = data.UserName;
      if (data.CustomerTag) s.customerTag = data.CustomerTag;
    } finally {
      refreshInFlight.delete(sid);
    }
  })();
  refreshInFlight.set(sid, promise);
  await promise;
  return !!store.get(sid)?.accessToken;
}