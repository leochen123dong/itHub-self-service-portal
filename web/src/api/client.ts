// 后端 fetch 包装，统一错误处理

const BASE = (import.meta.env.VITE_API_BASE as string) || '/api';

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
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
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