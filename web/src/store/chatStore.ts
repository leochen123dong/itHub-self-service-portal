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
    if (!Array.isArray(templates) || templates.length === 0) {
      console.warn('[ticket] catalog returned no templates');
      return null;
    }
    // Dump full list to console so misclassifications are visible at a glance.
    console.log(
      '[ticket] catalog templates (first 5):',
      templates.slice(0, 5),
    );
    console.log(
      '[ticket] catalog summary:',
      templates.map((t) => ({
        id: t.TicketTemplateId,
        name: t.Name,
        active: t.Active,
        tag: t.Tag,
      })),
    );

    // The list endpoint only returns {id, name, active, tag}. The critical
    // "can I actually create a ticket?" fields — OwnerUserGroupId,
    // AssignedUserGroupId, CustomerTag — only show up in the detail GET.
    // So we can't filter purely on the list response.
    //
    // Strategy: collect a small candidate pool (incident-named first, then
    // anything), do detail GETs, pick the first one whose detail has
    // OwnerUserGroupId set. The Active flag is unreliable in this tenant —
    // some Active templates have no Owner group and 404 on create, while
    // some Inactive ones work fine.
    const eligible = templates
      .filter((t) => typeof t?.TicketTemplateId === 'number' && t.TicketTemplateId > 0)
      .slice()
      .sort((a, b) => {
        const ai = String(a.Name ?? '').toLowerCase().includes('incident') ? 0 : 1;
        const bi = String(b.Name ?? '').toLowerCase().includes('incident') ? 0 : 1;
        return ai - bi;
      })
      .slice(0, 8); // probe at most 8 to bound latency

    // Score each candidate and pick the best one. A template is usable iff:
//   1. It has OwnerUserGroupId and AssignedUserGroupId (so the ticket has
//      an owning group).
//   2. Its Script reads from input.* (uses our Summary/Description) rather
//      than hardcoding values for a specific use case. Templates whose
//      Script instantiates ITHub-only classes (e.g. new TicketCategoryItem())
//      throw at runtime and 404 the create.
// Score = +2 per group set, +2 if Script reads input.X, -3 if Script has
// hardcoded strings (looks for `ticket.X = "..."`), -5 if Script
// instantiates any `new XxxItem()`.
    function scoreTemplate(detail: Record<string, unknown>): number {
      let s = 0;
      if (detail.OwnerUserGroupId != null) s += 2;
      if (detail.AssignedUserGroupId != null) s += 2;
      const script = String(detail.Script ?? '');
      if (/input\.\s*\w+/.test(script)) s += 2;
      if (/ticket\.\w+\s*=\s*"/.test(script)) s -= 3;
      if (/new\s+\w+Item\s*\(/.test(script)) s -= 5;
      return s;
    }

    let best: { id: number; name: string; detail: Record<string, unknown>; score: number } | null = null;
    for (const cand of eligible) {
      try {
        const detail = (await catalogApi.get(cand.TicketTemplateId)) as unknown as Record<string, unknown>;
        const score = scoreTemplate(detail);
        console.log(
          '[ticket] candidate',
          cand.TicketTemplateId,
          cand.Name,
          'score=', score,
          'scriptSnippet=',
          String(detail.Script ?? '').slice(0, 80),
        );
        if (score < 0) continue;
        if (!best || score > best.score) {
          best = { id: cand.TicketTemplateId, name: cand.Name ?? '', detail, score };
        }
      } catch (e) {
        console.warn('[ticket] detail GET failed for', cand.TicketTemplateId, (e as Error)?.message);
      }
    }
    if (best) {
      cachedTemplateId = best.id;
      console.log('[ticket] picked template:', cachedTemplateId, 'name:', best.name, 'score=', best.score);
      return cachedTemplateId;
    }
    console.warn('[ticket] no usable template found after scoring');
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

    // Resolve which template to use. byCheckPoint may return a pre-filled
    // template ID for the AIChat context; otherwise we fall back to the
    // best-scored template from the catalog.
    let templateId: number | undefined;
    let ticketType: number | undefined;
    try {
      const cp = await ticketsApi.byCheckPoint(`AIChat:${chatId}`);
      const item =
        cp?.TicketIncidentItems?.[0] ||
        cp?.TicketChangeItems?.[0] ||
        cp?.TicketRequestItems?.[0] ||
        cp?.TicketProblemItems?.[0];
      if (item) {
        templateId = item.TicketTemplateId;
        // Pick the ticketType from which array we matched (0/1/2/3).
        ticketType =
          cp?.TicketIncidentItems?.[0] === item
            ? 0
            : cp?.TicketProblemItems?.[0] === item
            ? 1
            : cp?.TicketChangeItems?.[0] === item
            ? 2
            : 3;
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
      throw new Error('未找到可用的工单模板');
    }

    // Server now knows the correct ITHub create path
    // (POST /api/ServiceDesk/Customers/{tag}/TicketTemplates/{id}/TicketIncidents)
    // and forwards with the tenant ApiKey. We just send the user-input
    // fields.
    try {
      const created = await ticketsApi.create({
        templateId,
        ticketType,
        summary: finalDesc.slice(0, 200),
        description: finalDesc,
      });
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