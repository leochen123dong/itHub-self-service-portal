import { api } from './client';
import type { AIProfile, ChatInitResponse, ChatMessageResponse, SuggestedAction } from '../types/api';

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
};