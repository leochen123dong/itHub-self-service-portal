import { Router } from 'express';
import { config } from '../config.js';
import { requireSession } from '../session/middleware.js';
import { requireAdmin } from '../middleware/admin.js';
import { chatCompletion } from '../ai/minimax.js';
import { buildKbContext } from '../ai/kbContext.js';
import {
  appendAssistantMessage,
  appendUserMessage,
  createChat,
  getChat,
  listChats,
  toMiniMaxHistory,
} from '../ai/chatStore.js';
import { getChatRatings, getStats, rateMessage, type Rating } from '../ai/ratingStore.js';

interface ChatMessage {
  Role: 'User' | 'Assistant' | string;
  Content: string;
  CreatedUtc?: string;
}

interface SuggestedAction {
  Text: string;
}

export const aiRouter = Router();

// Canned suggested actions for the welcome state and after assistant replies.
// These don't need an LLM round-trip and give users something useful to click.
const STARTER_SUGGESTIONS: SuggestedAction[] = [
  { Text: '我的 VPN 连不上怎么办？' },
  { Text: '忘记密码，如何重置？' },
  { Text: 'Outlook 收不到邮件' },
  { Text: '申请新笔记本电脑' },
];

const POST_REPLY_SUGGESTIONS: SuggestedAction[] = [
  { Text: '我试过了，问题还在' },
  { Text: '需要联系 IT 工程师' },
  { Text: '转人工开单' },
];

aiRouter.get('/profiles', requireSession, (_req, res): void => {
  // Synthetic profile so the UI that lists profiles has something to display.
  res.json([
    {
      AIProfileId: 1,
      Name: 'IT 助手 (MiniMax)',
      Tag: 'selfservice',
      Description: `Direct MiniMax model: ${config.minimax.model}`,
      Active: true,
    },
  ]);
});

aiRouter.post('/chat/init', requireSession, async (req, res): Promise<void> => {
  const { initialMessage, knowledgeArticleId, ticketId } = req.body ?? {};
  const session = req.session!;
  let context: 'None' | 'Ticket' | 'KnowledgeArticle' = 'None';
  let contextId: number | string | undefined;
  if (knowledgeArticleId) {
    context = 'KnowledgeArticle';
    contextId = knowledgeArticleId;
  } else if (ticketId) {
    context = 'Ticket';
    contextId = ticketId;
  }

  const chat = createChat({
    userId: session.userId,
    userName: session.userName,
    context,
    contextId,
    initialMessage,
  });

  // If a starter message was provided, kick off a MiniMax reply so the
  // user sees an answer immediately (mirrors ITHub's InitiateAIChat behavior).
  let messages: ChatMessage[] = [];
  if (initialMessage) {
    try {
      const kbContext = await buildKbContext(session.accessToken, initialMessage, 5);
      if (kbContext) {
        console.log(`[kb] injected context length=${kbContext.length}`);
      }
      const reply = await chatCompletion({
        messages: toMiniMaxHistory(chat),
        extraSystem: kbContext ? [kbContext] : [],
      });
      appendAssistantMessage(chat.chatId, reply.content);
      messages = [
        { Role: 'User', Content: initialMessage },
        { Role: 'Assistant', Content: reply.content },
      ];
    } catch (err) {
      // Surface the error in the response so the frontend can display it
      const zh = err instanceof Error ? err.message : 'AI 服务暂不可用';
      messages = [{ Role: 'Assistant', Content: `（AI 回复失败：${zh}）` }];
    }
  }

  res.json({
    AIChatId: chat.chatId,
    ChatTitle: initialMessage ? initialMessage.slice(0, 40) : '新对话',
    Messages: messages,
  });
});

aiRouter.post('/chat/message', requireSession, async (req, res): Promise<void> => {
  const { aiChatId, content } = req.body ?? {};
  if (!aiChatId || !content) {
    res.status(400).json({
      error: { code: 'INVALID_REQUEST', message_zh: '缺少 aiChatId 或 content' },
    });
    return;
  }
  const chat = getChat(aiChatId);
  if (!chat) {
    res.status(404).json({
      error: { code: 'CHAT_NOT_FOUND', message_zh: '对话不存在或已过期' },
    });
    return;
  }
  if (chat.userId !== req.session!.userId) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message_zh: '无权访问该对话' },
    });
    return;
  }

  appendUserMessage(aiChatId, content);
  try {
    const kbContext = await buildKbContext(req.session!.accessToken, content, 5);
    if (kbContext) {
      // Diagnostic: log exactly which articles we fed the model so we can
      // tell whether the model ignored them or we never sent the right ones.
      console.log(`[kb] injected context length=${kbContext.length}`);
    }
    const reply = await chatCompletion({
      messages: toMiniMaxHistory(getChat(aiChatId)!),
      extraSystem: kbContext ? [kbContext] : [],
    });
    appendAssistantMessage(aiChatId, reply.content);
    res.json({
      Messages: [{ Role: 'Assistant', Content: reply.content }],
      SuggestedActions: POST_REPLY_SUGGESTIONS,
    });
  } catch (err: any) {
    const zh =
      err?.status === 401
        ? 'API 认证失败，请检查 MINIMAX_API_KEY'
        : err?.status === 408
        ? 'AI 响应超时，请稍后再试'
        : err?.message || 'AI 服务暂不可用，请稍后再试';
    res.status(err?.status || 502).json({
      error: { code: err?.code || 'AI_ERROR', message_zh: zh },
    });
  }
});

aiRouter.get('/chat/suggestions', requireSession, (req, res): void => {
  // context: 0=None (fresh chat), 2=Ticket, 5=KnowledgeArticle
  const ctx = Number(req.query.context ?? 0);
  const isFresh = ctx === 0;
  res.json({
    Prompt: isFresh ? '试着问我：' : '',
    SuggestedActions: isFresh ? STARTER_SUGGESTIONS : POST_REPLY_SUGGESTIONS,
  });
});

aiRouter.get('/chat/:chatId/messages', requireSession, (req, res): void => {
  const chat = getChat(req.params.chatId);
  if (!chat) {
    res.status(404).json({
      error: { code: 'CHAT_NOT_FOUND', message_zh: '对话不存在或已过期' },
    });
    return;
  }
  if (chat.userId !== req.session!.userId) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message_zh: '无权访问该对话' },
    });
    return;
  }
  const ratings = getChatRatings(req.params.chatId);
  res.json({
    Messages: chat.messages.map((m, idx) => ({
      Role: m.role === 'user' ? 'User' : 'Assistant',
      Content: m.content,
      Rating: m.role === 'assistant' ? ratings[idx] ?? null : undefined,
    })),
    SuggestedActions: chat.messages.length === 0 ? STARTER_SUGGESTIONS : POST_REPLY_SUGGESTIONS,
  });
});

aiRouter.get('/chats', requireSession, (req, res): void => {
  const ctx = Number(req.query.context ?? 0);
  const userId = req.session!.userId;
  const all = listChats(userId);
  const filtered = ctx === 0 ? all : all.filter((c) => {
    if (ctx === 2) return c.context === 'Ticket';
    if (ctx === 5) return c.context === 'KnowledgeArticle';
    return true;
  });
  res.json(
    filtered.map((c) => ({
      AIChatId: c.chatId,
      ChatTitle: c.messages[0]?.content?.slice(0, 60) || '新对话',
      UpdatedUtc: new Date(c.updatedAt).toISOString(),
    })),
  );
});

// POST /api/ai/chat/:chatId/messages/:msgIndex/rate
// Body: { rating: 'up' | 'down' }
aiRouter.post('/chat/:chatId/messages/:msgIndex/rate', requireSession, (req, res): void => {
  const { chatId } = req.params;
  const msgIndex = parseInt(req.params.msgIndex, 10);
  const { rating } = req.body ?? {};

  if (!rating || (rating !== 'up' && rating !== 'down')) {
    res.status(400).json({
      error: { code: 'INVALID_RATING', message_zh: 'rating 必须为 up 或 down' },
    });
    return;
  }
  if (!Number.isFinite(msgIndex) || msgIndex < 0) {
    res.status(400).json({
      error: { code: 'INVALID_INDEX', message_zh: 'msgIndex 不合法' },
    });
    return;
  }

  const chat = getChat(chatId);
  if (!chat) {
    res.status(404).json({
      error: { code: 'CHAT_NOT_FOUND', message_zh: '对话不存在或已过期' },
    });
    return;
  }
  if (chat.userId !== req.session!.userId) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message_zh: '无权访问该对话' },
    });
    return;
  }
  if (msgIndex >= chat.messages.length) {
    res.status(400).json({
      error: { code: 'INDEX_OUT_OF_RANGE', message_zh: '消息索引超出范围' },
    });
    return;
  }
  // Only assistant messages can be rated.
  if (chat.messages[msgIndex].role !== 'assistant') {
    res.status(400).json({
      error: { code: 'NOT_ASSISTANT', message_zh: '只能给 AI 消息评分' },
    });
    return;
  }

  const record = rateMessage({
    chatId,
    msgIndex,
    rating: rating as Rating,
    userId: req.session!.userId,
    userName: req.session!.userName,
  });
  res.json({
    chatId: record.chatId,
    msgIndex: record.msgIndex,
    rating: record.rating,
    at: record.at,
  });
});

// GET /api/ai/chat/:chatId/ratings — restore rating UI state after page reload
aiRouter.get('/chat/:chatId/ratings', requireSession, (req, res): void => {
  const chat = getChat(req.params.chatId);
  if (!chat) {
    res.status(404).json({
      error: { code: 'CHAT_NOT_FOUND', message_zh: '对话不存在或已过期' },
    });
    return;
  }
  if (chat.userId !== req.session!.userId) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message_zh: '无权访问该对话' },
    });
    return;
  }
  res.json({ chatId: req.params.chatId, ratings: getChatRatings(req.params.chatId) });
});

// GET /api/ai/admin/stats — aggregate rating metrics
aiRouter.get('/admin/stats', requireSession, requireAdmin, (_req, res): void => {
  res.json(getStats());
});