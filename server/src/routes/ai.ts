import { Router } from 'express';
import { config } from '../config.js';
import { requireSession } from '../session/middleware.js';
import { requireAdmin } from '../middleware/admin.js';
import { chatCompletion } from '../ai/minimax.js';
import { buildKbContext, resolveKbId } from '../ai/kbContext.js';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import {
  appendAssistantMessage,
  appendUserMessage,
  createChat,
  getChat,
  listChats,
  toMiniMaxHistory,
} from '../ai/chatStore.js';
import { getChatRatings, getStats, rateMessage, type Rating } from '../ai/ratingStore.js';
import { getKbUsageStats, recordKbUsage } from '../ai/kbUsageStore.js';
import { bumpVersion, getVersion } from '../ai/kbVersionStore.js';

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
      const { context: kbContext, refs } = await buildKbContext(session.accessToken, initialMessage, 3);
      if (kbContext) {
        console.log(`[kb] injected context length=${kbContext.length}`);
      }
      const reply = await chatCompletion({
        messages: toMiniMaxHistory(chat),
        extraSystem: kbContext ? [kbContext] : [],
      });
      appendAssistantMessage(chat.chatId, reply.content, refs);
      recordKbUsage(refs);
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
    const { context: kbContext, refs } = await buildKbContext(req.session!.accessToken, content, 3);
    if (kbContext) {
      // Diagnostic: log exactly which articles we fed the model so we can
      // tell whether the model ignored them or we never sent the right ones.
      console.log(`[kb] injected context length=${kbContext.length}`);
    }
    const reply = await chatCompletion({
      messages: toMiniMaxHistory(getChat(aiChatId)!),
      extraSystem: kbContext ? [kbContext] : [],
    });
    appendAssistantMessage(aiChatId, reply.content, refs);
    recordKbUsage(refs);
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

// GET /api/ai/admin/kb-usage — KB reference ranking + never-cited list
aiRouter.get('/admin/kb-usage', requireSession, requireAdmin, async (req, res): Promise<void> => {
  try {
    const stats = await getKbUsageStats(req.session!.accessToken);
    res.json(stats);
  } catch (err) {
    const zh = err instanceof Error ? err.message : '加载 KB 引用统计失败';
    res.status(502).json({ error: { code: 'KB_USAGE_FAILED', message_zh: zh } });
  }
});

// --- Feature B: AI summarization of a ticket into a KB draft --------

// Helper: pull ticket detail + journals from ITHub and produce a flat text
// blob suitable for sending to MiniMax as user-message content. Tolerates
// partial failures (e.g. journals endpoint down) — falls back to whatever we
// got.
async function fetchTicketContent(
  accessToken: string,
  ticketId: string,
): Promise<string> {
  const parts: string[] = [];
  try {
    const ticket = (await ithubFetch<any>(`/api/ServiceDesk/Tickets/${ticketId}`, {
      accessToken,
      apiKey: config.ithub.apiKey,
    })) as Record<string, unknown>;
    if (ticket.Summary) parts.push(`主题：${String(ticket.Summary)}`);
    if (ticket.Description) parts.push(`描述：${String(ticket.Description)}`);
  } catch (e) {
    parts.push(`（工单详情读取失败：${(e as Error)?.message}）`);
  }

  try {
    const journals = (await ithubFetch<any>(
      `/api/ServiceDesk/Tickets/${ticketId}/TicketJournals`,
      { accessToken, apiKey: config.ithub.apiKey },
    )) as any[];
    if (Array.isArray(journals) && journals.length) {
      parts.push('\n处理记录：');
      for (const j of journals) {
        const html = String(j.Html || j.Content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!html) continue;
        const who = j.UserName || j.ContactName || '系统';
        parts.push(`- [${who}] ${html}`);
      }
    }
  } catch (e) {
    parts.push(`（处理记录读取失败：${(e as Error)?.message}）`);
  }

  const blob = parts.join('\n');
  // 8KB is generous for the prompt; longer blobs just slow MiniMax without
  // improving the summary.
  return blob.length > 8 * 1024 ? blob.slice(0, 8 * 1024) + '\n…(已截断)' : blob;
}

// Defensive JSON parser — MiniMax sometimes wraps the JSON in ```json fences
// or adds prose around it. We pull the first {...} block.
function parseKbDraftJson(raw: string): { title: string; summary: string; body: string } {
  const trimmed = raw.trim();
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object') {
      return {
        title: String(obj.title ?? '').slice(0, 100) || '（未命名）',
        summary: String(obj.summary ?? '').slice(0, 200),
        body: String(obj.body ?? ''),
      };
    }
  } catch {
    /* fall through */
  }
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      return {
        title: String(obj.title ?? '').slice(0, 100) || '（未命名）',
        summary: String(obj.summary ?? '').slice(0, 200),
        body: String(obj.body ?? ''),
      };
    } catch {
      /* fall through */
    }
  }
  // Last resort: treat the entire response as body.
  return { title: '（未命名）', summary: trimmed.slice(0, 200), body: trimmed };
}

// POST /api/ai/tickets/:id/kb-draft — generate a KB article draft from the
// ticket's full content (description + journals). Returns { title, summary, body }
// for the modal to render.
aiRouter.post('/tickets/:id/kb-draft', requireSession, async (req, res): Promise<void> => {
  const ticketId = req.params.id;
  const accessToken = req.session!.accessToken;
  try {
    const content = await fetchTicketContent(accessToken, ticketId);
    if (!content.trim()) {
      res.status(400).json({
        error: { code: 'EMPTY_TICKET', message_zh: '工单内容为空，无法生成 KB 草稿' },
      });
      return;
    }
    const prompt = `你是一名 IT 支持工程师。请根据以下工单内容写一篇企业内部知识库文章。仅输出 JSON：{"title":"≤30字","summary":"≤100字","body":"Markdown 正文，使用 ## 二级标题分节，操作步骤用有序列表"}。不要解释，不要 Markdown 代码块包裹。

工单内容：
${content}`;
    const reply = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    });
    const draft = parseKbDraftJson(reply.content);
    res.json(draft);
  } catch (err) {
    const zh = err instanceof Error ? err.message : '生成 KB 草稿失败';
    res.status(502).json({ error: { code: 'KB_DRAFT_FAILED', message_zh: zh } });
  }
});

// POST /api/ai/kb/publish — write a KB article to ITHub.
//
// 2-step flow (verified by _debug probes fillProbe / fillProbeV2-V5):
//   1. POST creates a draft with metadata (Identifier, CustomerId/Tag,
//      KnowledgeBaseId, ParentKnowledgeCategoryId, KnowledgeCategoryId).
//      ITHub accepts it with 200 + null body, but **silently drops the
//      content fields** (Summary, Description, Active, Status) —
//      the resulting row has no title, no body, and Status=Draft.
//   2. GET the list, match by Summary → articleId. ITHub rewrites our
//      long "K{Date.now()}" Identifier to "K{articleId}" internally, so
//      we can't match by Identifier. Read replica lags the write by
//      3-5s, so retry with backoff up to ~15s.
//   3. PUT the article at the **top-level** path
//      `/api/Knowledge/KnowledgeArticles/{articleId}` (NOT the nested
//      `/KnowledgeBases/{kbId}/KnowledgeArticles/{id}` — that returns
//      404, and PATCH is 405). ITHub's top-level PUT handler writes
//      Summary, Description, Status, and Active correctly.
//
// GOTCHA — body field name is **`Description`** (not `DescriptionText`).
// Verified by fillProbeV4 GET keys `["Summary", "Description"]` and the
// working kbRepair run on K100103. `DescriptionText` is silently dropped
// on PUT — returns 200 but no write. Other rejected names (Body/Content/
// Html/Text) also silently drop. Don't rename back to DescriptionText.
//
// GOTCHA — `CustomerTag` in body MUST equal `config.ithub.customerTag`
// (the SESSION's customer tag), NOT the admin sample's "demo" tag. A
// mismatch silently rolls back even the metadata fields.
//
// `CustomerTag` must be the SESSION's customer tag (config.ithub
// .customerTag) — not the existingSample's "demo" tag. Mismatched
// tags get the silent-drop behavior even on the metadata fields.
//
// Body: { title, summary, body, knowledgeBaseId? }
aiRouter.post('/kb/publish', requireSession, async (req, res): Promise<void> => {
  const { title, summary, body, knowledgeBaseId } = req.body ?? {};
  if (!title || !body) {
    res.status(400).json({
      error: { code: 'INVALID', message_zh: '缺少 title 或 body' },
    });
    return;
  }
  const accessToken = req.session!.accessToken;
  const draft = { title, summary, body };

  // 1. Resolve kbId. Caller-provided wins, else auto-discover.
  let kbId: number | null = null;
  if (typeof knowledgeBaseId === 'number') {
    kbId = knowledgeBaseId;
  } else {
    try {
      kbId = await resolveKbId(accessToken, config.ithub.customerTag);
    } catch {
      /* keep null */
    }
  }
  if (!kbId) {
    res.status(400).json({
      error: {
        code: 'NO_KB',
        message_zh: '未找到可写入的知识库。请在工单页提供 knowledgeBaseId。',
        draft,
      },
    });
    return;
  }

  // 2. Build a unique Identifier. ITHub's KB_Identifier column requires
  // uniqueness; "K" + Date.now() gives us a one-off that's safe enough
  // for the demo. If you hit a collision, re-run — Date.now() will be
  // a different millisecond.
  const identifier = 'K' + Date.now();

  // Step 1: POST creates a draft with metadata. Send every field from
  // K100003 (including read-only expanded ones) so ITHub's row
  // validation passes — content fields are still ignored here, we set
  // them in step 3.
  try {
    await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
      {
        method: 'POST',
        accessToken,
        body: {
          Identifier: identifier,
          CustomerId: 3,
          CustomerTag: config.ithub.customerTag,
          KnowledgeBaseId: kbId,
          ParentKnowledgeCategoryId: 4,
          KnowledgeCategoryId: 5,
          KnowledgeCategoryName: 'Hardware',
          KnowledgeCategoryDescription: '',
          // Content fields sent on POST — ITHub silently drops these, but
          // the PUT in step 3 re-sends them so it's the source of truth.
          // NOTE: ITHub's actual body field is `Description` (verified by
          // fillProbeV4 GET keys showing `["Summary","Description"]`).
          // `DescriptionText` is silently ignored — that's why older
          // articles (K100101-K100103) had empty Description.
          Summary: String(title).slice(0, 200),
          Description: String(body),
          KnowledgeArticleStatus: 0,
          Active: true,
          AccessFlags: 2147483647,
          KnowledgeArticleAccessFlags: 2147483647,
          KnowledgeArticleServiceDeskAccessFlags: 2147483647,
        },
      },
    );
  } catch (e) {
    const err = e as ITHubError;
    res.status(502).json({
      error: {
        code: 'KB_PUBLISH_FAILED',
        message_zh: 'KB 创建草稿失败：' + (err.upstreamMessage ?? err.message ?? 'ITHub 拒绝'),
        upstreamErrors: [{ endpoint: 'POST nested', status: err.status ?? 500, message: err.upstreamMessage ?? err.message ?? '' }],
        draft,
      },
    });
    return;
  }

  // Step 2: find the new articleId. ITHub rewrites our long
  // "K{Date.now()}" Identifier to "K{articleId}" internally (observed
  // in listProbe — K100101 was sent as K1782744889938 but stored as
  // K100101). So we can't match by Identifier — we match by Summary.
  // ITHub's read replica lags the write by ~3-5s on this tenant;
  // retry with backoff up to ~15s.
  let articleId = 0;
  const targetSummary = String(title).slice(0, 200);
  for (let i = 0; i < 10 && articleId === 0; i++) {
    await new Promise((r) => setTimeout(r, 500 + i * 700));
    try {
      const list = (await ithubFetch<any[]>(
        `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
        { accessToken, query: { $top: 50, $orderby: 'KnowledgeArticleId desc' } },
      )) as any[];
      if (Array.isArray(list)) {
        const ours = list.find((a) => a?.Summary === targetSummary);
        articleId = Number(ours?.KnowledgeArticleId ?? 0);
      }
    } catch {
      /* retry */
    }
  }
  if (!articleId) {
    res.json({
      articleId: 0,
      published: false,
      identifier,
      note: 'POST 创建了草稿但 15s 内 GET 列表找不到匹配 Summary 的文章。请到 ITHub admin 手动按 Summary 查找。',
    });
    return;
  }

  // Step 3: PUT the content. ITHub accepts PUT only on the TOP-LEVEL
  // path `/api/Knowledge/KnowledgeArticles/{articleId}` — the nested
  // `/KnowledgeBases/{kbId}/KnowledgeArticles/{id}` returns 404, and
  // PATCH on either returns 405. ITHub's body comes back as `true`
  // on success.
  try {
    await ithubFetch<any>(
      `/api/Knowledge/KnowledgeArticles/${articleId}`,
      {
        method: 'PUT',
        accessToken,
        body: {
          Identifier: identifier,
          CustomerId: 3,
          CustomerTag: config.ithub.customerTag,
          KnowledgeBaseId: kbId,
          ParentKnowledgeCategoryId: 4,
          KnowledgeCategoryId: 5,
          KnowledgeCategoryName: 'Hardware',
          KnowledgeCategoryDescription: '',
          Summary: String(title).slice(0, 200),
          Description: String(body),
          KnowledgeArticleStatus: 0,
          Active: true,
          AccessFlags: 2147483647,
          KnowledgeArticleAccessFlags: 2147483647,
          KnowledgeArticleServiceDeskAccessFlags: 2147483647,
        },
      },
    );
    const version = bumpVersion(articleId);
    res.json({ articleId, published: true, identifier, version });
  } catch (e) {
    // Draft is created; the PUT just failed to fill content. Surface
    // the error so the user can retry the publish, but keep the
    // articleId so they can find the draft in admin.
    const err = e as ITHubError;
    res.status(502).json({
      error: {
        code: 'KB_PUBLISH_PARTIAL',
        message_zh: 'KB 草稿已创建 (#' + articleId + ') 但填写内容失败：' + (err.upstreamMessage ?? err.message ?? 'ITHub 拒绝'),
        upstreamErrors: [{ endpoint: 'PUT top-level', status: err.status ?? 500, message: err.upstreamMessage ?? err.message ?? '' }],
        articleId,
        identifier,
        draft,
      },
    });
  }
});

// POST /api/chat/summarize — compress a chat transcript into a one-liner
// (≤80 zh chars) for use as the ITHub ticket Description. The full
// transcript still goes into ITHub Journals via /api/tickets/escalate;
// this is just the short summary for the Description field.
//
// Body: { messages: Array<{ Role: 'User'|'Assistant'|string; Content: string }> }
// Response: { summary: string }
// On failure: 502 with { code, message_zh } so the client can fall back.
aiRouter.post('/chat/summarize', requireSession, async (req, res): Promise<void> => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  // Only keep User/Assistant turns and drop empty bodies. Map to a flat
  // "用户：xxx\nAI：yyy" string so MiniMax sees what we see.
  const turns = messages
    .filter(
      (m: any) =>
        m &&
        (m.Role === 'User' || m.Role === 'Assistant') &&
        typeof m.Content === 'string' &&
        m.Content.trim(),
    )
    .map((m: any) => `${m.Role === 'User' ? '用户' : 'AI'}：${m.Content.trim()}`)
    .join('\n');

  if (!turns) {
    res.status(400).json({
      error: { code: 'EMPTY_MESSAGES', message_zh: '没有可总结的对话内容' },
    });
    return;
  }

  const prompt = `你是一名 IT 支持工程师的助手。请根据以下用户与 AI 的对话记录，**精简成一句话**（≤50 个中文字）作为工单描述。
要求：
- 用客观陈述句，说清楚"用户遇到了什么问题"
- 不要出现"用户"或"AI"等主语
- 不要客套话、不要"以下是..."之类的开头
- 只输出精简结果本身，不要任何解释或前缀

对话记录：
${turns}`;

  try {
    const reply = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    const summary = reply.content.trim().slice(0, 100) || '（AI 未返回摘要）';
    res.json({ summary });
  } catch (err: any) {
    const zh =
      err?.status === 401
        ? 'AI 服务认证失败'
        : err?.status === 408
        ? 'AI 响应超时'
        : err?.message || 'AI 精简失败';
    res.status(err?.status || 502).json({
      error: { code: err?.code || 'AI_SUMMARIZE_FAILED', message_zh: zh },
    });
  }
});

// Admin-only debug: probe ITHub's KB read+write API. Two modes:
//
// Body: { knowledgeBaseId?, dryRun?: boolean, kbRepair?: { articleId, summary?, body } }
//   dryRun=true             — GET-list the existing articles and return their
//                             field names. No writes.
//   kbRepair={ articleId, body, summary? } — PUT content into an existing
//                             empty article (uses the working Description
//                             field name verified by fillProbeV4). Useful
//                             for backfilling articles that lost their body
//                             during the early probe runs.
aiRouter.post('/_debug/ithub-kb-publish', requireSession, requireAdmin, async (req, res): Promise<void> => {
  if (!config.ithub.apiKey) {
    res.status(500).json({ error: { code: 'NO_API_KEY', message_zh: '服务端未配置 ITHUB_API_KEY' } });
    return;
  }
  const accessToken = req.session!.accessToken;
  const dryRun = req.body?.dryRun === true;

  // Resolve kbId. Caller-provided wins, else auto-discover.
  let kbId: number | null = typeof req.body?.knowledgeBaseId === 'number' ? req.body.knowledgeBaseId : null;
  if (!kbId) {
    try {
      kbId = await resolveKbId(accessToken, config.ithub.customerTag);
    } catch {
      /* null */
    }
  }
  if (!kbId) {
    res.status(400).json({
      error: { code: 'NO_KB', message_zh: '未找到 KB。请在请求 body 里传 knowledgeBaseId 或在 .env 配 KB_ID' },
    });
    return;
  }

  // Step 1: GET existing articles to learn the field shape. Cheap and
  // gives us the real field names (Name vs Title, DescriptionText vs Body)
  // for this tenant — ITHub is OData so field names are stable per tenant.
  let existingSample: any = null;
  try {
    const list = (await ithubFetch<any[]>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
      { accessToken, query: { $top: 1 } },
    )) as any[];
    if (Array.isArray(list) && list.length) {
      existingSample = list[0];
    }
  } catch (e) {
    // fall through — sample is best-effort
  }

  if (dryRun) {
    res.json({ kbId, dryRun: true, existingSample, existingKeys: existingSample ? Object.keys(existingSample) : [] });
    return;
  }

  // kbRepair: fill an existing empty article by sending the same body
  // /kb/publish sends in step 3. Use this to backfill articles that were
  // created before the DescriptionText→Description field rename.
  //
  // Body: { articleId: number, summary?: string, body: string }
  // Returns: { ok, before, after, excerpt }
  if (typeof req.body?.kbRepair === 'object' && req.body.kbRepair !== null) {
    const { articleId, body, summary } = req.body.kbRepair as {
      articleId?: number;
      summary?: string;
      body?: string;
    };
    if (typeof articleId !== 'number' || typeof body !== 'string') {
      res.status(400).json({
        error: { code: 'INVALID', message_zh: 'kbRepair 需要 { articleId, body }' },
      });
      return;
    }
    const accessToken = req.session!.accessToken;

    // GET current full record so PUT has every NOT NULL column.
    let current: Record<string, unknown> = {};
    try {
      current = (await ithubFetch<any>(
        `/api/Knowledge/KnowledgeArticles/${articleId}`,
        { accessToken },
      )) as Record<string, unknown>;
    } catch (e) {
      const err = e as ITHubError;
      res.status(err.status || 500).json({
        error: {
          code: err.code || 'KB_REPAIR_GET_FAILED',
          message_zh: '读取文章失败：' + (err.upstreamMessage ?? err.message ?? ''),
        },
      });
      return;
    }

    const before = {
      summary: current.Summary,
      descriptionLen:
        typeof current.Description === 'string' ? (current.Description as string).length : null,
      descriptionPreview:
        typeof current.Description === 'string'
          ? (current.Description as string).slice(0, 200)
          : null,
    };

    // Use caller's summary if provided, else keep existing.
    const finalSummary =
      typeof summary === 'string' && summary.trim()
        ? summary.slice(0, 200)
        : (current.Summary as string);

    try {
      await ithubFetch<any>(`/api/Knowledge/KnowledgeArticles/${articleId}`, {
        method: 'PUT',
        accessToken,
        body: {
          ...current,
          Summary: finalSummary,
          Description: String(body),
          KnowledgeArticleStatus: 0, // Draft
        },
      });
    } catch (e) {
      const err = e as ITHubError;
      res.status(err.status || 500).json({
        error: {
          code: err.code || 'KB_REPAIR_PUT_FAILED',
          message_zh: 'PUT 失败：' + (err.upstreamMessage ?? err.message ?? ''),
          before,
        },
      });
      return;
    }

    const version = bumpVersion(articleId);

    // Read back to confirm.
    await new Promise((r) => setTimeout(r, 2000));
    let after: { summary: unknown; descriptionLen: number | null; descriptionPreview: string | null } = {
      summary: null,
      descriptionLen: null,
      descriptionPreview: null,
    };
    try {
      const r = (await ithubFetch<any>(
        `/api/Knowledge/KnowledgeArticles/${articleId}`,
        { accessToken },
      )) as Record<string, unknown>;
      after = {
        summary: r.Summary,
        descriptionLen:
          typeof r.Description === 'string' ? (r.Description as string).length : null,
        descriptionPreview:
          typeof r.Description === 'string'
            ? (r.Description as string).slice(0, 200)
            : null,
      };
    } catch {
      /* ignore */
    }

    res.json({
      ok: (after.descriptionLen ?? 0) > 0,
      articleId,
      before,
      after,
      version,
      excerpt: after.descriptionPreview,
      note:
        (after.descriptionLen ?? 0) > 0
          ? '✅ 写入成功。ITHub 副本有 2s 延迟，请到 admin 刷新查看。'
          : '❌ 写入后 readBack 仍为空 —— Description 字段名可能仍不对，需要继续探测。',
    });
    return;
  }

  res.status(400).json({
    error: {
      code: 'NO_MODE',
      message_zh: '此调试路由只支持 dryRun 和 kbRepair 两种模式，其他调试探针已清理。',
    },
  });
});
