// 后端 fetch 包装，统一错误处理

const BASE = (import.meta.env.VITE_API_BASE as string) || '/api';

// Module-scoped throttle for the "any-401 toast" event so a transient
// burst doesn't spam the UI. Not a force-logout — see web/src/components/Layout.tsx.
let last401ToastAt = 0;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, messageZh: string) {
    super(messageZh);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // GET 请求禁用浏览器/中间层缓存 —— ITHub admin 端改完 KB 状态后，
  // Portal 不重新拉就拿不到最新值。每次 GET 都带 cache: 'no-store' +
  // 时间戳 query 让 fetch 不复用任何 HTTP cache（kb 写入场景不算
  // 高频调用，这点开销可忽略）。
  const isGet = (init.method ?? 'GET').toUpperCase() === 'GET';
  const finalPath =
    isGet && !path.includes('_=')
      ? `${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`
      : path;
  const res = await fetch(`${BASE}${finalPath}`, {
    credentials: 'include',
    cache: isGet ? 'no-store' : 'default',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    ...init,
  });

  const text = await res.text();
  let body: any = undefined;
  if (text) {
    try { body = JSON.parse(text); } catch { /* ignore */ }
  }

  if (!res.ok) {
    const err = body?.error;
    // Surface ANY 401 as a single window-level toast per minute (skipping
    // /api/auth/*, where 401 just means "wrong credentials"). Layout
    // subscribes and shows a helpful toast. We deliberately do NOT auto-
    // logout here — a write-side 401 (e.g. ticket creation denied) is
    // often an ITHub permission issue, not a session expiry, and
    // kicking the user back to login would just make things worse.
    if (
      res.status === 401 &&
      !path.startsWith('/auth/') &&
      !path.startsWith('/api/auth/') &&
      Date.now() - last401ToastAt > 60_000
    ) {
      last401ToastAt = Date.now();
      const messageZh = err?.message_zh || `请求失败 (401, ${path})`;
      window.dispatchEvent(
        new CustomEvent('ithub:api-error-401', {
          detail: { path, message: messageZh, code: err?.code },
        }),
      );
    }
    if (err?.message_zh) {
      throw new ApiError(res.status, err.code, err.message_zh);
    }
    throw new ApiError(res.status, 'UNKNOWN', `请求失败 (${res.status})`);
  }

  return body as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>(p, { method: 'GET' }),
  post: <T = any>(p: string, body?: any) =>
    request<T>(p, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T = any>(p: string, body?: any) =>
    request<T>(p, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T = any>(p: string) => request<T>(p, { method: 'DELETE' }),
};