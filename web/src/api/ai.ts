import { api } from './client';
import type {
  AIProfile,
  AdminStats,
  ChatInitResponse,
  ChatMessageResponse,
  KbUsageStats,
  RatingResponse,
  SuggestedAction,
} from '../types/api';

export const aiApi = {
  profiles: () => api.get<AIProfile[]>('/ai/profiles'),

  initChat: (data: { initialMessage?: string; knowledgeArticleId?: number; ticketId?: number }) =>
    api.post<ChatInitResponse>('/ai/chat/init', data),

  sendMessage: (aiChatId: string, content: string) =>
    api.post<ChatMessageResponse>('/ai/chat/message', { aiChatId, content }),

  getMessages: (chatId: string) =>
    api.get<ChatMessageResponse>(`/ai/chat/${chatId}/messages`),

  suggestions: (context: number = 0) =>
    api.get<{ Prompt?: string; SuggestedActions?: SuggestedAction[] }>(
      `/ai/chat/suggestions?context=${context}`,
    ),

  listChats: (context: number = 0) =>
    api.get<any[]>(`/ai/chats?context=${context}`),

  rateMessage: (chatId: string, msgIndex: number, rating: 'up' | 'down') =>
    api.post<RatingResponse>(`/ai/chat/${chatId}/messages/${msgIndex}/rate`, { rating }),

  getChatRatings: (chatId: string) =>
    api.get<{ chatId: string; ratings: Record<number, 'up' | 'down'> }>(
      `/ai/chat/${chatId}/ratings`,
    ),

  getAdminStats: () => api.get<AdminStats>('/ai/admin/stats'),

  getKbUsageStats: () => api.get<KbUsageStats>('/ai/admin/kb-usage'),

  // Ask MiniMax to summarize a ticket's full content (description + journals)
  // into a 3-field KB article draft. The user reviews and edits before
  // publishing to ITHub via kbPublish().
  kbDraft: (ticketId: number | string) =>
    api.post<{ title: string; summary: string; body: string }>(
      `/ai/tickets/${ticketId}/kb-draft`,
      {},
    ),

  kbPublish: (payload: { title: string; summary: string; body: string; knowledgeBaseId?: number }) =>
    api.post<
      | { articleId: number; published: true }
      | { error: { code: string; message_zh: string; upstreamErrors?: any[]; draft?: any } }
    >('/ai/kb/publish', payload),

  // Compress a chat transcript into a one-liner (≤80 zh chars) for use as
  // the ITHub ticket Description. The full transcript still goes into
  // ITHub Journals via /tickets/escalate; this is just the short summary.
  summarizeForTicket: (messages: Array<{ Role: string; Content: string }>) =>
    api.post<{ summary: string }>('/ai/chat/summarize', { messages }),
};