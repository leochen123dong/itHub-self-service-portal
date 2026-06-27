import { config } from '../config.js';
import { ITHubError } from '../http/errors.js';

export type MiniMaxRole = 'system' | 'user' | 'assistant';

export interface MiniMaxMessage {
  role: MiniMaxRole;
  content: string;
}

export interface MiniMaxChatOptions {
  messages: MiniMaxMessage[];
  /** Extra system messages to inject AFTER the default system prompt. */
  extraSystem?: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface MiniMaxChatResponse {
  content: string;
  raw: unknown;
}

const DEFAULT_SYSTEM_PROMPT = `你是 "ITHub 智能服务门户" 的 AI 助手，名叫 "IT 助手"。你的职责是帮助公司员工解决日常 IT 问题，例如：
- 网络连接（VPN、Wi-Fi、代理）
- 账号与密码（登录、SSO、MFA、密码重置）
- 软件安装与故障（Office、Teams、Outlook、打印机）
- 硬件问题（电脑、显示器、外设）
- 服务请求引导（申请设备、报修、权限申请）

回答风格：
1. 先用 1-2 句话直接给出最可能的解决方案或排查步骤。
2. 用编号列表列出具体操作步骤，便于用户照做。
3. 如果用户描述不够清晰，问 1 个关键的澄清问题。
4. 如果问题超出 IT 范畴或无法远程解决，明确告诉用户可以点击右下角"转人工"按钮提交工单，工程师会联系处理。
5. 不要编造公司内部的具体系统名、人名、流程编号；只提供通用的 IT 排错建议。
6. 回复使用中文，简洁友好。`;

function buildUrl(): string {
  const base = config.minimax.baseUrl.replace(/\/$/, '');
  // MiniMax's chat completion endpoint. The v2 path is the current standard;
  // if MINIMAX_BASE_URL already includes the path, use as-is.
  if (base.endsWith('/chatcompletion_v2') || base.endsWith('/chatcompletion')) {
    return base;
  }
  return `${base}/v1/text/chatcompletion_v2`;
}

export async function chatCompletion(opts: MiniMaxChatOptions): Promise<MiniMaxChatResponse> {
  if (!config.minimax.apiKey) {
    throw new ITHubError(
      503,
      'MINIMAX_NOT_CONFIGURED',
      'MiniMax API key 未配置，请在 Render Environment 设置 MINIMAX_API_KEY',
    );
  }
  const messages: MiniMaxMessage[] = opts.messages;
  const userTurns = messages.filter((m) => m.role !== 'system');
  const finalMessages: MiniMaxMessage[] = [
    { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
    ...(opts.extraSystem ?? []).map((s) => ({ role: 'system' as const, content: s })),
    ...userTurns,
  ];

  const body = {
    model: config.minimax.model,
    messages: finalMessages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
  };

  const url = buildUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.minimax.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    let json: any = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // not json
      }
    }
    if (!res.ok) {
      const upstreamMsg =
        (json && typeof json === 'object' && (json.base_resp?.status_msg || json.Message || json.message)) ||
        text?.slice(0, 300) ||
        res.statusText;
      throw new ITHubError(res.status, `MINIMAX_${res.status}`, String(upstreamMsg), String(upstreamMsg));
    }
    const content =
      json?.choices?.[0]?.message?.content ??
      json?.reply ??
      json?.message?.content ??
      '';
    if (!content) {
      throw new ITHubError(
        502,
        'MINIMAX_EMPTY',
        'MiniMax 返回为空，请稍后再试',
        (JSON.stringify(json ?? null) || '').slice(0, 300),
      );
    }
    return { content: String(content), raw: json };
  } catch (err: any) {
    clearTimeout(timer);
    if (err instanceof ITHubError) throw err;
    if (err?.name === 'AbortError') {
      throw new ITHubError(408, 'MINIMAX_TIMEOUT', 'MiniMax 请求超时');
    }
    throw new ITHubError(0, 'MINIMAX_NETWORK', err?.message || 'MiniMax 网络异常');
  }
}