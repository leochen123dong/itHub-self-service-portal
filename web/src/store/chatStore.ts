import { create } from 'zustand';
import { aiApi } from '../api/ai';
import { ticketsApi } from '../api/tickets';
import { catalogApi } from '../api/catalog';
import { adminUsersApi } from '../api/adminUsers';
import type { ChatMessage, SuggestedAction } from '../types/api';

// Cached after first successful fetch so we don't re-list templates on every
// escalation. We cache a sorted *list* of candidates (not just the winner)
// so escalateToTicket can try the next one if the first POST fails — ITHub
// may reject a specific template (e.g. wrong ticket type for the body, or
// permission denied) even when the heuristic ranked it highest.
let cachedTemplateIds: number[] = [];

async function resolveTemplateCandidates(): Promise<number[]> {
  if (cachedTemplateIds.length > 0) return cachedTemplateIds;
  // First try the admin-configured override. If set, treat it as the single
  // candidate. Don't fall back to the heuristic for that case — the admin
  // picked that template explicitly.
  try {
    const r = await adminUsersApi.getDefaultIncidentTemplate();
    const id = r?.templateId;
    if (typeof id === 'number' && id > 0) {
      cachedTemplateIds = [id];
      console.log('[ticket] using admin-configured default template:', id);
      return cachedTemplateIds;
    }
  } catch (e) {
    console.warn(
      '[ticket] admin default template lookup failed, falling back to heuristic:',
      (e as Error)?.message,
    );
  }
  try {
    const templates = await catalogApi.list();
    if (!Array.isArray(templates) || templates.length === 0) {
      console.warn('[ticket] catalog returned no templates');
      return [];
    }
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
    // anything), do detail GETs, score and rank. Keep top candidates so
    // escalateToTicket can retry the next-best on POST failure.
    const eligible = templates
      .filter((t) => typeof t?.TicketTemplateId === 'number' && t.TicketTemplateId > 0)
      .slice()
      .sort((a, b) => {
        const ai = String(a.Name ?? '').toLowerCase().includes('incident') ? 0 : 1;
        const bi = String(b.Name ?? '').toLowerCase().includes('incident') ? 0 : 1;
        return ai - bi;
      })
      .slice(0, 8); // probe at most 8 to bound latency

    // Score each candidate. A template is usable iff:
    //   1. It has OwnerUserGroupId and AssignedUserGroupId (so the ticket
    //      has an owning group).
    //   2. Its Script reads from input.* (uses our Summary/Description)
    //      rather than hardcoding values for a specific use case. Templates
    //      whose Script instantiates ITHub-only classes throw at runtime
    //      and 404 the create.
    // Score = +2 per group set, +2 if Script reads input.X, -3 if Script
    // has hardcoded strings (looks for `ticket.X = "..."`), -5 if Script
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

    const scored: Array<{ id: number; name: string; score: number }> = [];
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
        scored.push({ id: cand.TicketTemplateId, name: cand.Name ?? '', score });
      } catch (e) {
        console.warn('[ticket] detail GET failed for', cand.TicketTemplateId, (e as Error)?.message);
      }
    }
    // Sort descending by score, keep top 5 so escalateToTicket has fallbacks
    // if the top template's POST is rejected by ITHub.
    scored.sort((a, b) => b.score - a.score);
    const top5 = scored.slice(0, 5).map((s) => s.id);
    if (top5.length > 0) {
      cachedTemplateIds = top5;
      console.log(
        '[ticket] picked top candidates:',
        top5,
        'top score=',
        scored[0]?.score,
      );
      return cachedTemplateIds;
    }
    console.warn('[ticket] no usable template found after scoring');
    return [];
  } catch (e) {
    console.warn('[ticket] catalog.list failed:', (e as Error)?.message);
    return [];
  }
}

interface ChatState {
  chatId: string | null;
  chatTitle: string;
  messages: ChatMessage[];
  suggestions: SuggestedAction[];
  sending: boolean;
  // True while we're in the middle of an upgrade: AI summarize → ticket
  // create → journal sync. The chat UI uses this to disable the escalate
  // button and show a two-stage "AI 精简中…/创建中…" hint.
  escalating: boolean;
  createdTicketId: number | null;

  initChat: (initialMessage?: string) => Promise<void>;
  loadChat: (chatId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  refreshSuggestions: (context?: number) => Promise<void>;
  rateMessage: (msgIndex: number, rating: 'up' | 'down') => Promise<void>;
  escalateToTicket: (
    description?: string,
  ) => Promise<{ ticketId: number; journalPosted?: boolean; journalError?: string } | null>;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chatId: null,
  chatTitle: '',
  messages: [],
  suggestions: [],
  sending: false,
  escalating: false,
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

    set({ escalating: true });
    try {
      // Fallback string: last 6 turns joined — used if AI summary fails or
      // if the user passed in their own description. Always computed so
      // we have a non-empty body regardless of AI outcome.
      const fallbackSummary = messages
        .filter((m) => m.Role === 'User' || m.Role === 'Assistant')
        .slice(-6)
        .map((m) => `${m.Role === 'User' ? '用户' : 'AI'}：${m.Content}`)
        .join('\n\n');
      const userDesc = (description || '').trim();

      // Resolve which template to use. byCheckPoint may return a pre-filled
      // template ID for the AIChat context; otherwise we fall back to the
      // best-scored template from the catalog. We keep an ordered list of
      // candidates so the POST loop below can fall through if the first
      // template is rejected by ITHub (e.g. wrong ticket type for the
      // body, or transient permission error).
      const candidates: Array<{ templateId: number; ticketType?: number }> = [];
      let ticketType: number | undefined;
      try {
        const cp = await ticketsApi.byCheckPoint(`AIChat:${chatId}`);
        const item =
          cp?.TicketIncidentItems?.[0] ||
          cp?.TicketChangeItems?.[0] ||
          cp?.TicketRequestItems?.[0] ||
          cp?.TicketProblemItems?.[0];
        if (item) {
          candidates.push({ templateId: item.TicketTemplateId });
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

      // Fall back to the ranked heuristic list. We dedupe so the byCheckPoint
      // pick (if any) always tries first, then the heuristic picks fill in.
      const ranked = await resolveTemplateCandidates();
      for (const id of ranked) {
        if (!candidates.some((c) => c.templateId === id)) {
          candidates.push({ templateId: id });
        }
      }

      if (candidates.length === 0) {
        console.error('[ticket] no TicketTemplateId available, cannot create');
        throw new Error(
          '未找到可用的工单模板。请联系管理员在「API 使用管理」页设置默认工单模板，或刷新页面后重试。',
        );
      }

      // Ask MiniMax to compress the whole transcript into ≤80 zh chars. The
      // ITHub Description field is short — we don't want the last-N-turns
      // concatenation we used to push. On any failure (no API key, 5xx,
      // timeout) we silently fall back to the fallback summary so the
      // escalation flow never breaks.
      let aiSummary: string | null = null;
      try {
        const r = await aiApi.summarizeForTicket(
          messages
            .filter((m) => m.Role === 'User' || m.Role === 'Assistant')
            .map((m) => ({ Role: m.Role, Content: m.Content })),
        );
        aiSummary = r?.summary?.trim() || null;
      } catch (e) {
        console.warn('[ticket] AI summarize failed, using fallback:', (e as Error)?.message);
      }

      // Priority: AI summary > user description > fallback. The ITHub
      // Description and Summary fields are independent — Description holds
      // the same one-liner so the admin view isn't cluttered.
      const finalDesc = aiSummary || userDesc || fallbackSummary || '（无描述）';

      // Build the chat transcript as HTML for the journal sync. ITHub journals
      // expect <p>...</p> with <br> for newlines — same convention as the
      // server's appendJournalAsHtml helper.
      const chatTranscript = messages
        .filter((m) => m.Role === 'User' || m.Role === 'Assistant')
        .map((m) => {
          const label = m.Role === 'User' ? '用户' : 'AI';
          const body = m.Content.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');
          return `<p><strong>${label}：</strong>${body}</p>`;
        })
        .join('');

      // Atomic create + journal-sync. Try each candidate in order — if
      // ITHub rejects the first template (wrong type, transient perm
      // error, etc.) we move on instead of failing the whole flow. The
      // server returns the created ticket plus a `journalPosted` flag so
      // we can warn if the journal write failed but the ticket was made.
      let lastError: string | null = null;
      for (const cand of candidates) {
        try {
          const created = await ticketsApi.escalate({
            templateId: cand.templateId,
            ticketType: cand.ticketType ?? ticketType,
            summary: finalDesc.slice(0, 200),
            description: finalDesc,
            chatTranscript,
          });
          const ticketId = created?.TicketId ?? created?.ticketId ?? created?.Id ?? null;
          if (ticketId) {
            if (cand.templateId !== candidates[0].templateId) {
              console.log(
                `[ticket] escalate succeeded on fallback template #${cand.templateId} ` +
                  `(primary #${candidates[0].templateId} failed: ${lastError})`,
              );
            }
            set({ createdTicketId: ticketId });
            return {
              ticketId,
              journalPosted: created?.journalPosted,
              journalError: created?.journalError,
            };
          }
          console.error('[ticket] escalate returned no id:', created);
          return null;
        } catch (e) {
          lastError = (e as Error)?.message || String(e);
          console.warn(
            `[ticket] escalate failed on template #${cand.templateId}, trying next. error=`,
            lastError,
          );
          // Continue to next candidate. 401 from requireSession means the
          // whole session is dead — no point trying other templates.
          if (lastError.includes('请先登录')) break;
        }
      }
      console.error('[ticket] escalate failed on all candidates. last error:', lastError);
      // Surface the actual error rather than a generic "请稍后再试" so the
      // user knows what went wrong (and can tell the admin).
      throw new Error(lastError || '所有候选模板都创建失败');
    } finally {
      set({ escalating: false });
    }
  },

  reset: () => set({
    chatId: null,
    chatTitle: '',
    messages: [],
    suggestions: [],
    sending: false,
    escalating: false,
    createdTicketId: null,
  }),
}));