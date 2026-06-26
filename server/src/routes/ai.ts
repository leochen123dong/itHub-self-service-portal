import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { config } from '../config.js';
import { requireSession } from '../session/middleware.js';

export const aiRouter = Router();

// UserAIChatContext enum (Gemmb.AI.UserAIChatContext)
const CTX = {
  None: 0,
  Device: 1,
  Ticket: 2,
  Tickets: 3,
  TicketEmailsChat: 4,
  KnowledgeArticle: 5,
  KnowledgeArticles: 6,
  Alert: 7,
} as const;

function pickProfileId(): number {
  const id = config.ai.profileId;
  if (!id) {
    throw new ITHubError(
      503,
      'NO_AI_PROFILE',
      'AI Profile 未配置，请在 server/.env 设置 AI_PROFILE_ID 或允许启动时自动发现',
    );
  }
  return parseInt(id, 10);
}

function forwardUpstreamError(err: unknown, fallbackMessage: string) {
  if (err instanceof ITHubError) {
    const zh =
      err.status === 401
        ? '会话已过期，请重新登录'
        : err.status === 403
        ? '没有 AI 访问权限'
        : err.status === 404
        ? 'AI 资源未找到'
        : err.status >= 500
        ? 'AI 服务暂不可用，请稍后再试'
        : err.upstreamMessage || fallbackMessage;
    return { status: err.status || 500, body: { error: { code: err.code, message_zh: zh } } };
  }
  return { status: 500, body: { error: { code: 'UNKNOWN', message_zh: fallbackMessage } } };
}

aiRouter.get('/profiles', requireSession, async (req, res): Promise<void> => {
  try {
    const profiles = await ithubFetch<any[]>('/api/AI/AIProfiles', {
      accessToken: req.session!.accessToken,
    });
    res.json(profiles);
  } catch (err) {
    const { status, body } = forwardUpstreamError(err, '获取 AI 配置失败');
    res.status(status).json(body);
  }
});

aiRouter.post('/chat/init', requireSession, async (req, res): Promise<void> => {
  const { initialMessage, knowledgeArticleId, ticketId } = req.body ?? {};
  try {
    const profileId = pickProfileId();
    let url: string;
    let body: any;
    if (knowledgeArticleId) {
      url = `/api/AI/AIProfiles/${profileId}/InitiateKnowledgeArticleAIChat`;
      body = { KnowledgeArticleId: knowledgeArticleId, UserMessage: initialMessage ?? '', UserAIChatContext: CTX.KnowledgeArticle };
    } else if (ticketId) {
      url = `/api/AI/AIProfiles/${profileId}/InitiateTicketAIChat`;
      body = { TicketId: ticketId, UserMessage: initialMessage ?? '', UserAIChatContext: CTX.Ticket };
    } else {
      url = `/api/AI/AIProfiles/${profileId}/InitiateAIChat`;
      body = { InitialMessage: initialMessage ?? '', UserAIChatContext: CTX.None };
    }
    const data = await ithubFetch<any>(url, {
      method: 'POST',
      accessToken: req.session!.accessToken,
      body,
    });
    res.json(data);
  } catch (err) {
    const { status, body } = forwardUpstreamError(err, '开启对话失败');
    res.status(status).json(body);
  }
});

aiRouter.post('/chat/message', requireSession, async (req, res): Promise<void> => {
  const { aiChatId, content } = req.body ?? {};
  if (!aiChatId || !content) {
    res.status(400).json({
      error: { code: 'INVALID_REQUEST', message_zh: '缺少 aiChatId 或 content' },
    });
    return;
  }
  try {
    const data = await ithubFetch<any>('/api/AI/AIChats/UserMessage', {
      method: 'POST',
      accessToken: req.session!.accessToken,
      body: { AIChatId: aiChatId, Content: content },
    });
    res.json(data);
  } catch (err) {
    const { status, body } = forwardUpstreamError(err, '发送消息失败');
    res.status(status).json(body);
  }
});

aiRouter.get('/chat/:chatId/messages', requireSession, async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>(
      `/api/AI/AIChats/${req.params.chatId}/AIChatMessages`,
      { accessToken: req.session!.accessToken },
    );
    res.json(data);
  } catch (err) {
    const { status, body } = forwardUpstreamError(err, '获取对话历史失败');
    res.status(status).json(body);
  }
});

aiRouter.get('/chat/suggestions', requireSession, async (req, res): Promise<void> => {
  // userAIChatContext is an enum int; default None = 0
  const ctx = Number(req.query.context ?? CTX.None);
  try {
    const data = await ithubFetch<any>(
      `/api/AI/AIChats/${ctx}/AIChatPromptSuggestedActions`,
      { accessToken: req.session!.accessToken },
    );
    res.json(data);
  } catch (err) {
    const { status, body } = forwardUpstreamError(err, '获取建议操作失败');
    res.status(status).json(body);
  }
});

aiRouter.get('/chats', requireSession, async (req, res): Promise<void> => {
  try {
    const profileId = pickProfileId();
    const ctx = Number(req.query.context ?? CTX.None);
    const offset = Number(req.query.offset ?? 0);
    const count = Number(req.query.count ?? 50);
    const data = await ithubFetch<any>(
      `/api/AI/AIProfiles/${profileId}/${ctx}/AIChats`,
      { accessToken: req.session!.accessToken, query: { offset, count } },
    );
    res.json(data);
  } catch (err) {
    const { status, body } = forwardUpstreamError(err, '获取对话列表失败');
    res.status(status).json(body);
  }
});