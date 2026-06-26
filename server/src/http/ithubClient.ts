import { config } from '../config.js';
import { ITHubError } from './errors.js';

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 1;
const RETRY_STATUSES = new Set([502, 503, 504]);

interface FetchOptions {
  method?: string;
  body?: unknown;
  accessToken?: string | null;
  query?: Record<string, string | number | undefined | null>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: FetchOptions['query']): string {
  const url = new URL(path, config.ithub.baseUrl);
  url.searchParams.set('customerTag', config.ithub.customerTag);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function ithubFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, accessToken, query, timeoutMs = TIMEOUT_MS, signal } = options;
  const url = buildUrl(path, query);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers['AccessToken'] = accessToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = signal
      ? anySignal([signal, controller.signal])
      : controller.signal;

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: combinedSignal,
      });
      clearTimeout(timer);

      const text = await res.text();
      let json: unknown = undefined;
      if (text) {
        try { json = JSON.parse(text); } catch { /* not json */ }
      }

      if (!res.ok) {
        const upstreamMsg =
          (json && typeof json === 'object' && 'Message' in (json as object) && typeof (json as any).Message === 'string')
            ? (json as any).Message
            : (json && typeof json === 'object' && 'message' in (json as object) && typeof (json as any).message === 'string')
            ? (json as any).message
            : text?.slice(0, 200) || res.statusText;
        const code =
          (json && typeof json === 'object' && 'Code' in (json as object) && typeof (json as any).Code === 'string')
            ? (json as any).Code
            : `HTTP_${res.status}`;
        if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw new ITHubError(res.status, code, upstreamMsg, upstreamMsg);
      }
      return json as T;
    } catch (err: any) {
      clearTimeout(timer);
      lastErr = err;
      if (err instanceof ITHubError) throw err;
      if (err?.name === 'AbortError') {
        if (signal?.aborted) throw err;
        if (attempt < MAX_RETRIES) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw new ITHubError(408, 'TIMEOUT', '请求超时');
      }
      throw new ITHubError(0, err?.code || 'NETWORK_ERROR', err?.message || '网络异常', err?.message);
    }
  }
  throw lastErr instanceof ITHubError ? lastErr : new ITHubError(0, 'UNKNOWN', '请求失败');
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}