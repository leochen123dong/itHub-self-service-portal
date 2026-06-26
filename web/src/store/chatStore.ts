import { create } from 'zustand';
import { aiApi } from '../api/ai';
import { ticketsApi } from '../api/tickets';
import type { ChatMessage, SuggestedAction } from '../types/api';

interface ChatState {
  chatId: string | null;
  chatTitle: string;
  messages: ChatMessage[];
  suggestions: SuggestedAction[];
  sending: boolean;
  createdTicketId: number | null;

  initChat: (initialMessage?: string) => Promise<void>;
  loadChat: (chatId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  refreshSuggestions: (context?: number) => Promise<void>;
  escalateToTicket: (description?: string) => Promise<{ ticketId: number } | null>;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chatId: null,
  chatTitle: '',
  messages: [],
  suggestions: [],
  sending: false,
  createdTicketId: null,

  initChat: async (initialMessage) => {
    const r = await aiApi.initChat({ initialMessage: initialMessage ?? '' });
    set({
      chatId: r.AIChatId,
      chatTitle: r.ChatTitle || '新对话',
      messages: r.Messages || (initialMessage
        ? [{ Role: 'User', Content: initialMessage }]
        : []),
      suggestions: [],
      createdTicketId: null,
    });
    // Pull suggested starter actions for a fresh chat
    get().refreshSuggestions(0).catch(() => {});
  },

  loadChat: async (chatId) => {
    const r = await aiApi.getMessages(chatId);
    set({
      chatId,
      chatTitle: (r as any).ChatTitle || '对话',
      messages: r.Messages || [],
    });
  },

  sendMessage: async (content) => {
    const { chatId, messages } = get();
    if (!chatId) {
      // No active chat yet → init one with this message
      await get().initChat(content);
      // After init, immediately send a follow-up to get AI response
      const newChatId = get().chatId;
      if (!newChatId) return;
      set({ sending: true });
      try {
        const r = await aiApi.sendMessage(newChatId, content);
        set({
          messages: [...get().messages, ...(r.Messages || [])],
          suggestions: r.SuggestedActions || [],
        });
      } finally {
        set({ sending: false });
      }
      return;
    }
    set({ sending: true, messages: [...messages, { Role: 'User', Content: content }] });
    try {
      const r = await aiApi.sendMessage(chatId, content);
      set({
        messages: [...get().messages, ...(r.Messages || [])],
        suggestions: r.SuggestedActions || [],
      });
    } finally {
      set({ sending: false });
    }
  },

  refreshSuggestions: async (context = 0) => {
    const r = await aiApi.suggestions(context);
    set({ suggestions: r.SuggestedActions || [] });
  },

  escalateToTicket: async (description) => {
    const { messages, chatId } = get();
    if (!chatId) return null;

    // Use ByCheckPoint to get template items for an AIChat context
    // The checkpoint string identifies this chat — backend/IThub will map to a ticket template
    const summary = messages
      .filter((m) => m.Role === 'User' || m.Role === 'Assistant')
      .slice(-6)
      .map((m) => `${m.Role === 'User' ? '用户' : 'AI'}：${m.Content}`)
      .join('\n\n');
    const finalDesc = (description || '').trim() || summary || '（无描述）';

    // First call ByCheckPoint — try a few checkpoint patterns the upstream may understand.
    // Pattern: encode the chat id as the checkpoint; if it doesn't match, the upstream
    // will return generic templates the user can pick from.
    let checkpoint = `AIChat:${chatId}`;
    try {
      const cp = await ticketsApi.byCheckPoint(checkpoint);
      // For demo, just take the first incident item and create a ticket using its template data
      const item = cp.TicketIncidentItems?.[0] || cp.TicketChangeItems?.[0]
        || cp.TicketRequestItems?.[0] || cp.TicketProblemItems?.[0];
      const payload = item ? { ...item, Summary: finalDesc.slice(0, 200) } : {
        TicketTemplateId: cp.TicketIncidentItems?.[0]?.TicketTemplateId || 0,
        Summary: finalDesc.slice(0, 200),
        Description: finalDesc,
      };
      const created = await ticketsApi.create(payload);
      const ticketId = created?.TicketId ?? created?.ticketId ?? created?.Id ?? null;
      if (ticketId) {
        set({ createdTicketId: ticketId });
        return { ticketId };
      }
    } catch (e) {
      // Fallback: synthesize a minimal incident ticket
      const created = await ticketsApi.create({
        Summary: `AI 求助转工单 (chat: ${chatId.slice(0, 8)})`,
        Description: finalDesc,
      });
      const ticketId = created?.TicketId ?? created?.ticketId ?? created?.Id ?? null;
      if (ticketId) {
        set({ createdTicketId: ticketId });
        return { ticketId };
      }
    }
    return null;
  },

  reset: () => set({
    chatId: null,
    chatTitle: '',
    messages: [],
    suggestions: [],
    sending: false,
    createdTicketId: null,
  }),
}));