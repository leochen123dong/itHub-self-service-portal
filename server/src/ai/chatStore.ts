import { randomUUID } from 'node:crypto';
import type { MiniMaxMessage } from './minimax.js';

interface ChatSession {
  chatId: string;
  userId: number;
  userName: string;
  context: 'None' | 'Ticket' | 'KnowledgeArticle';
  contextId?: number | string;
  createdAt: number;
  updatedAt: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    at: number;
  }>;
}

// In-memory chat store keyed by chatId. Survives until process restart or
// explicit clear. Per-session map avoids cross-user leakage.
const chats = new Map<string, ChatSession>();

// Auto-cleanup: drop chats idle for >2h every 10min
const IDLE_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, chat] of chats) {
    if (now - chat.updatedAt > IDLE_MS) chats.delete(id);
  }
}, 10 * 60 * 1000).unref();

export interface CreateChatInput {
  userId: number;
  userName: string;
  context?: 'None' | 'Ticket' | 'KnowledgeArticle';
  contextId?: number | string;
  initialMessage?: string;
}

export function createChat(input: CreateChatInput): ChatSession {
  const now = Date.now();
  const chat: ChatSession = {
    chatId: randomUUID(),
    userId: input.userId,
    userName: input.userName,
    context: input.context ?? 'None',
    contextId: input.contextId,
    createdAt: now,
    updatedAt: now,
    messages: input.initialMessage
      ? [{ role: 'user', content: input.initialMessage, at: now }]
      : [],
  };
  chats.set(chat.chatId, chat);
  return chat;
}

export function getChat(chatId: string): ChatSession | undefined {
  return chats.get(chatId);
}

export function appendUserMessage(chatId: string, content: string): ChatSession | undefined {
  const chat = chats.get(chatId);
  if (!chat) return undefined;
  chat.messages.push({ role: 'user', content, at: Date.now() });
  chat.updatedAt = Date.now();
  return chat;
}

export function appendAssistantMessage(chatId: string, content: string): ChatSession | undefined {
  const chat = chats.get(chatId);
  if (!chat) return undefined;
  chat.messages.push({ role: 'assistant', content, at: Date.now() });
  chat.updatedAt = Date.now();
  return chat;
}

export function listChats(userId: number): ChatSession[] {
  return Array.from(chats.values())
    .filter((c) => c.userId === userId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function toMiniMaxHistory(chat: ChatSession): MiniMaxMessage[] {
  return chat.messages.map((m) => ({ role: m.role, content: m.content }));
}