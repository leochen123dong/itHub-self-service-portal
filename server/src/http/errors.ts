export class ITHubError extends Error {
  status: number;
  code: string;
  upstreamMessage?: string;

  constructor(status: number, code: string, message: string, upstreamMessage?: string) {
    super(message);
    this.name = 'ITHubError';
    this.status = status;
    this.code = code;
    this.upstreamMessage = upstreamMessage;
  }
}

export function toChineseMessage(status: number, code?: string, upstream?: string): string {
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return '请求超时，请稍后再试';
  if (status === 401) return '会话已过期，请重新登录';
  if (status === 403) return '没有访问权限';
  if (status === 404) return '未找到资源';
  if (status === 429) return '操作过于频繁，请稍后再试';
  if (status >= 500) return '服务繁忙，请稍后再试';
  if (status === 400 && upstream) return `请求参数错误：${upstream}`;
  return upstream || '请求失败，请稍后再试';
}