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

    for (const cand of eligible) {
      try {
        const detail = (await catalogApi.get(cand.TicketTemplateId)) as unknown as Record<string, unknown>;
        if (detail?.OwnerUserGroupId != null && detail?.AssignedUserGroupId != null) {
          cachedTemplateId = cand.TicketTemplateId;
          console.log(
            '[ticket] picked template:',
            cachedTemplateId,
            'name:',
            cand.Name,
            `(groups set, probed ${eligible.indexOf(cand) + 1}/${eligible.length})`,
          );
          return cachedTemplateId;
        }
        console.log(
          '[ticket] skip template',
          cand.TicketTemplateId,
          cand.Name,
          '— no Owner/Assigned group',
        );
      } catch (e) {
        console.warn('[ticket] detail GET failed for', cand.TicketTemplateId, (e as Error)?.message);
      }
    }
    console.warn('[ticket] no template with Owner/Assigned group set');
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
      throw new Error('未找到可用的工单模板');
    }

    // Fetch the full template detail so we can spread its TenantId /
    // OwnerUserGroup / AssignedUserGroup into the create payload. The list
    // endpoint returns a stripped-down object that ITHub rejects with 404
    // when used as a ticket-create payload, even with a valid
    // TicketTemplateId. The single-template GET returns the fields needed
    // for creation.
    let templateDetail: Record<string, unknown> | undefined;
    try {
      const detail = await catalogApi.get(templateId);
      templateDetail = detail as unknown as Record<string, unknown>;
      console.log('[ticket] template detail keys:', Object.keys(detail ?? {}));
    } catch (e) {
      console.warn('[ticket] catalog.get failed:', (e as Error)?.message);
    }

    const payload: Record<string, unknown> = {
      ...(preFilled ?? {}),
      ...(templateDetail ?? {}),
      TicketTemplateId: templateId,
      Summary: finalDesc.slice(0, 200),
      Description: finalDesc,
    };
    // Dump a compact view: id fields + critical owner/group + summary/desc
    const slim = Object.fromEntries(
      Object.entries(payload).filter(([k]) =>
        /^(Ticket(Id|GroupId|Type|State|Status|Category)|OwnerUserGroup(Id|Name)|AssignedUserGroup(Id|Name)|Customer(Tag|Id|Name)|Priority|Impact|Urgency|Active|CreateOnSubmit|AccessFlags|TicketTemplateAccessFlags|Sid|SecurityContainerSid|Summary|Description)$/i.test(k),
      ),
    );
    console.log('[ticket] payload (id fields):', slim);

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