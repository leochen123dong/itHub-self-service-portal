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
  if (sid) store.delete(sid);
}

export function purgeExpired() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}

// Periodically purge
setInterval(purgeExpired, 5 * 60_000).unref?.();