import { Router } from 'express';
import { config } from '../config.js';
import { requireSession } from '../session/middleware.js';
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
  res.json({
    Messages: chat.messages.map((m) => ({
      Role: m.role === 'user' ? 'User' : 'Assistant',
      Content: m.content,
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