import { create } from 'zustand';
import { aiApi } from '../api/ai';
import { ticketsApi } from '../api/tickets';
import { catalogApi } from '../api/catalog';
import type { ChatMessage, SuggestedAction } from '../types/api';

// Cached after first successful fetch so we don't re-list templates on every
// escalation. A real tenant usually has 5-50 templates; for the demo this is
// the only one we care about.
let cachedTemplateId: number | null = null;

async function resolveTemplateId(): Promise<number | null> {
  if (cachedTemplateId !== null) return cachedTemplateId;
  try {
    const templates = await catalogApi.list();
    const first = Array.isArray(templates) ? templates[0] : null;
    const id = first?.TicketTemplateId ?? null;
    if (typeof id === 'number') {
      cachedTemplateId = id;
      console.log('[ticket] resolved template id:', id, 'name:', first?.Name);
      return id;
    }
    console.warn('[ticket] no templates returned from catalog:', templates);
    return null;
  } catch (e) {
    console.warn('[ticket] catalog.list failed:', (e as Error)?.message);
    return null;
  }
}

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
  rateMessage: (msgIndex: number, rating: 'up' | 'down') => Promise<void>;
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

  rateMessage: async (msgIndex, rating) => {
    const { chatId, messages } = get();
    if (!chatId) return;
    const target = messages[msgIndex];
    if (!target || target.Role !== 'Assistant') return;

    // Optimistic update — flip back on error.
    const previous = target.Rating;
    set({
      messages: messages.map((m, i) =>
        i === msgIndex ? { ...m, Rating: rating } : m,
      ),
    });
    try {
      await aiApi.rateMessage(chatId, msgIndex, rating);
    } catch {
      set({
        messages: get().messages.map((m, i) =>
          i === msgIndex ? { ...m, Rating: previous ?? null } : m,
        ),
      });
    }
  },

  escalateToTicket: async (description) => {
    const { messages, chatId } = get();
    if (!chatId) return null;

    const summary = messages
      .filter((m) => m.Role === 'User' || m.Role === 'Assistant')
      .slice(-6)
      .map((m) => `${m.Role === 'User' ? '用户' : 'AI'}：${m.Content}`)
      .join('\n\n');
    const finalDesc = (description || '').trim() || summary || '（无描述）';

    // Strategy: try ByCheckPoint first (it may return a pre-filled incident
    // template). If that doesn't yield a usable item, fall back to listing
    // available ticket templates and using the first one — a TicketTemplateId
    // of 0 or undefined causes ITHub to return 404.
    let templateId: number | undefined;
    let preFilled: Record<string, unknown> | undefined;
    try {
      const cp = await ticketsApi.byCheckPoint(`AIChat:${chatId}`);
      const item =
        cp?.TicketIncidentItems?.[0] ||
        cp?.TicketChangeItems?.[0] ||
        cp?.TicketRequestItems?.[0] ||
        cp?.TicketProblemItems?.[0];
      if (item) {
        templateId = item.TicketTemplateId;
        preFilled = { ...item };
      }
    } catch (e) {
      console.warn('[ticket] byCheckPoint failed:', (e as Error)?.message);
    }

    if (templateId === undefined || templateId === 0 || templateId === null) {
      const id = await resolveTemplateId();
      if (typeof id === 'number') templateId = id;
    }

    if (!templateId) {
      console.error('[ticket] no TicketTemplateId available, cannot create');
      return null;
    }

    const payload = {
      ...(preFilled ?? {}),
      TicketTemplateId: templateId,
      Summary: finalDesc.slice(0, 200),
      Description: finalDesc,
    };
    console.log('[ticket] creating with templateId=', templateId);

    try {
      const created = await ticketsApi.create(payload);
      const ticketId = created?.TicketId ?? created?.ticketId ?? created?.Id ?? null;
      if (ticketId) {
        set({ createdTicketId: ticketId });
        return { ticketId };
      }
      console.error('[ticket] create returned no id:', created);
      return null;
    } catch (e) {
      console.error('[ticket] create failed:', (e as Error)?.message);
      return null;
    }
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