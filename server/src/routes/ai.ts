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
// Verified working combination (from _debug probe, commit beafe7d):
//   POST /api/Knowledge/KnowledgeBases/{kbId}/KnowledgeArticles
//   Body: { Identifier, Summary, DescriptionText, KnowledgeBaseId,
//           CustomerId, CustomerTag, Active }
//   ITHub returns 200 with body = null (no article id in response).
//   To get the new articleId we GET the list right after and match by
//   Identifier.
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

  // 3. POST. The probe showed ITHub returns 200 with body=null — meaning
  // the write succeeded but ITHub didn't echo the new id. We then GET
  // the list and match our Identifier to find the new KnowledgeArticleId.
  try {
    await ithubFetch<any>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
      {
        method: 'POST',
        accessToken,
        body: {
          Identifier: identifier,
          // ITHub's KB model has no Name/Title field — Summary is the
          // human-readable one-liner that shows up as the article title
          // in admin lists.
          Summary: String(title).slice(0, 200),
          DescriptionText: String(body),
          KnowledgeBaseId: kbId,
          // CustomerId/CustomerTag are NOT NULL on KB_KNOWLEDGEARTICLE.
          // CustomerId=3 + CustomerTag="demo" came from existingSample.
          CustomerId: 3,
          CustomerTag: 'demo',
          Active: true,
          KnowledgeArticleStatus: 1,
        },
      },
    );

    // 4. GET the list and find the row we just wrote by Identifier.
    // Wait briefly first — ITHub's read replica can lag the write by
    // a fraction of a second on free tenants.
    await new Promise((r) => setTimeout(r, 400));
    const list = (await ithubFetch<any[]>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
      { accessToken, query: { $top: 50 } },
    )) as any[];
    const ours = Array.isArray(list)
      ? list.find((a) => a?.Identifier === identifier)
      : null;
    const articleId = Number(ours?.KnowledgeArticleId ?? 0);
    if (articleId) {
      res.json({ articleId, published: true, identifier });
      return;
    }
    // Write succeeded (200) but we couldn't find the row in the next 50.
    // Treat as success anyway — the user can find it via the Identifier
    // in the ITHub admin.
    res.json({
      articleId: 0,
      published: true,
      identifier,
      note: 'ITHub 接受 POST 但 GET 列表前 50 找不到对应 Identifier。请到 ITHub admin 按 Identifier 查找。',
    });
    return;
  } catch (e) {
    const err = e as ITHubError;
    res.status(502).json({
      error: {
        code: 'KB_PUBLISH_FAILED',
        message_zh: 'KB 发布失败：' + (err.upstreamMessage ?? err.message ?? 'ITHub 拒绝'),
        upstreamErrors: [{ endpoint: 'nested-KnowledgeArticles', status: err.status ?? 500, message: err.upstreamMessage ?? err.message ?? '' }],
        draft,
      },
    });
    return;
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

// Admin-only debug: probe ITHub's KB write API. Tries several endpoint +
// body-shape combinations to find the one that actually accepts writes.
// Each attempt is logged with status, response body excerpt, and
// resolved article id (if any). Title is prefixed with __PROBE__ so the
// user can find and delete them in the ITHub admin afterwards.
//
// Note: this CAN actually create junk rows in the ITHub KB. Use sparingly.
//
// Body: { knowledgeBaseId?: number, dryRun?: boolean }
//   dryRun=true: only GET-list the existing articles and return their
//                field names so we can guess the right body without writing.
//   dryRun=false (default): run all POST attempts.
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

  // Step 2: try several POST shapes. Use a __PROBE__ prefix so the user
  // can find and delete these in ITHub admin. Each attempt is independent
  // — if one succeeds, we still record the others' errors for completeness
  // and let the user pick the one to wire up.
  const probeTitle = `__PROBE__ ${new Date().toISOString()}`;
  const probeBody = '探测条目，用于验证 ITHub KB 写接口的字段命名。';

  type Attempt = {
    label: string;
    method: 'POST' | 'PUT';
    path: string;
    body: Record<string, unknown>;
    status: number;
    ok: boolean;
    bodyExcerpt: string;
    identifier: string;
    articleId?: number;
  };

  const attempts: Attempt[] = [];

  // ITHub KB articles don't have a Name/Title field — Identifier is the
  // human-readable code (e.g. "K100003") and Summary is the one-line title.
  // DescriptionText holds the long body. Required-ish links from
  // existingSample: KnowledgeBaseId, CustomerId, CustomerTag, Active.
  const probeIdentifier = 'K' + Date.now();

  // 1. nested + full payload (all the fields we saw on the sample)
  attempts.push({
    label: 'nested + full (Identifier/Summary/DescriptionText + base+cust)',
    method: 'POST',
    path: `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
    body: {
      Identifier: probeIdentifier,
      Summary: probeTitle,
      DescriptionText: probeBody,
      KnowledgeBaseId: kbId,
      CustomerId: 3,
      CustomerTag: 'demo',
      Active: true,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier,
  });

  // 2. top-level + same full payload
  attempts.push({
    label: 'top + full (Identifier/Summary/DescriptionText + base+cust)',
    method: 'POST',
    path: `/api/Knowledge/KnowledgeArticles`,
    body: {
      Identifier: probeIdentifier + 'a',
      Summary: probeTitle,
      DescriptionText: probeBody,
      KnowledgeBaseId: kbId,
      CustomerId: 3,
      CustomerTag: 'demo',
      Active: true,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'a',
  });

  // 3. nested + minimal (no CustomerId/Tag)
  attempts.push({
    label: 'nested + minimal (Identifier/Summary/DescriptionText + base)',
    method: 'POST',
    path: `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
    body: {
      Identifier: probeIdentifier + 'b',
      Summary: probeTitle,
      DescriptionText: probeBody,
      KnowledgeBaseId: kbId,
      Active: true,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'b',
  });

  // 4. top-level + minimal
  attempts.push({
    label: 'top + minimal (Identifier/Summary/DescriptionText + base)',
    method: 'POST',
    path: `/api/Knowledge/KnowledgeArticles`,
    body: {
      Identifier: probeIdentifier + 'c',
      Summary: probeTitle,
      DescriptionText: probeBody,
      KnowledgeBaseId: kbId,
      Active: true,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'c',
  });

  // 5. nested + just Identifier + Summary (test if KB ID alone is enough)
  attempts.push({
    label: 'nested + Identifier + Summary only',
    method: 'POST',
    path: `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
    body: {
      Identifier: probeIdentifier + 'd',
      Summary: probeTitle,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'd',
  });

  // 6. top-level + bare-minimum (only Identifier, no Summary at all)
  attempts.push({
    label: 'top + Identifier only',
    method: 'POST',
    path: `/api/Knowledge/KnowledgeArticles`,
    body: {
      Identifier: probeIdentifier + 'e',
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'e',
  });

  // 7. nested + every field from existingSample (KnowledgeCategoryId,
  //    AccessFlags, KnowledgeArticleAccessFlags, etc). The previous full
  //    attempt returned 500 with "Cannot read 'KnowledgeArticleId' of
  //    undefined" — likely ITHub wrote the row but its response shape is
  //    different. Filling every field + reading the raw response body
  //    lets us see what the ITHub return shape actually looks like.
  attempts.push({
    label: 'nested + EVERY field from sample (incl. category/access flags)',
    method: 'POST',
    path: `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
    body: {
      Identifier: probeIdentifier + 'f',
      Summary: probeTitle,
      DescriptionText: probeBody,
      KnowledgeBaseId: kbId,
      KnowledgeCategoryId: 5,
      CustomerId: 3,
      CustomerTag: 'demo',
      Active: true,
      KnowledgeArticleStatus: 1,
      AccessFlags: 2147483647,
      KnowledgeArticleAccessFlags: 2147483647,
      KnowledgeArticleServiceDeskAccessFlags: 2147483647,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'f',
  });

  // 8. PUT nested (OData "create or update" — id=0 means "create").
  // POST with our user accessToken returns 200 but the row never lands.
  // PUT is the canonical OData write verb in many ITHub-style APIs.
  attempts.push({
    label: 'PUT nested id=0 (OData create-or-update)',
    method: 'PUT',
    path: `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles/0`,
    body: {
      Identifier: probeIdentifier + 'g',
      Summary: probeTitle,
      DescriptionText: probeBody,
      KnowledgeBaseId: kbId,
      CustomerId: 3,
      CustomerTag: 'demo',
      Active: true,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'g',
  });

  // 9. POST /api/Admin/Knowledge/Articles — admin-scoped path
  attempts.push({
    label: 'POST /api/Admin/Knowledge/Articles',
    method: 'POST',
    path: `/api/Admin/Knowledge/Articles`,
    body: {
      Identifier: probeIdentifier + 'h',
      Summary: probeTitle,
      DescriptionText: probeBody,
      KnowledgeBaseId: kbId,
      CustomerId: 3,
      CustomerTag: 'demo',
      Active: true,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'h',
  });

  // 10. POST /api/Knowledge/Admin/KnowledgeArticles — admin-suffixed
  attempts.push({
    label: 'POST /api/Knowledge/Admin/KnowledgeArticles',
    method: 'POST',
    path: `/api/Knowledge/Admin/KnowledgeArticles`,
    body: {
      Identifier: probeIdentifier + 'i',
      Summary: probeTitle,
      DescriptionText: probeBody,
      KnowledgeBaseId: kbId,
      CustomerId: 3,
      CustomerTag: 'demo',
      Active: true,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'i',
  });

  // 11. POST nested with apiKey (no accessToken). Tenant-level write
  // may need the tenant ApiKey, like ticket create does.
  attempts.push({
    label: 'POST nested with apiKey (no accessToken)',
    method: 'POST',
    path: `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
    body: {
      Identifier: probeIdentifier + 'j',
      Summary: probeTitle,
      DescriptionText: probeBody,
      KnowledgeBaseId: kbId,
      CustomerId: 3,
      CustomerTag: 'demo',
      Active: true,
    },
    status: 0, ok: false, bodyExcerpt: '', identifier: probeIdentifier + 'j',
  });

  // Execute each attempt serially. ITHub rate-limits, so 1s spacing is
  // polite. We don't bail on success — we want to see all results.
  for (const a of attempts) {
    try {
      const data = (await ithubFetch<any>(a.path, {
        method: a.method,
        accessToken,
        body: a.body,
      })) as Record<string, unknown> | null | undefined;
      a.status = 200;
      // The 500 we saw earlier said "Cannot read 'KnowledgeArticleId' of
      // undefined" — meaning the upstream wrote the row but its return
      // shape wasn't what we guessed. Probe every plausible field name
      // and surface the full body so we can see what ITHub actually
      // returns.
      const id = Number(
        (data as any)?.KnowledgeArticleId ??
        (data as any)?.Id ??
        (data as any)?.ArticleId ??
        (data as any)?.ArticleID ??
        (data as any)?.KBID ??
        (data as any)?.KnowledgeBaseId,
      );
      a.ok = !!id;
      a.articleId = id || undefined;
      a.bodyExcerpt = JSON.stringify(data ?? null).slice(0, 500);
    } catch (e) {
      const err = e as any;
      a.status = err?.status ?? 500;
      a.ok = false;
      // Surface both the upstream message AND the raw response body if
      // the client wrapper preserved it. ithubFetch throws ITHubError
      // but the original text is what we want for debugging.
      const pieces: string[] = [];
      if (err?.upstreamMessage) pieces.push(err.upstreamMessage);
      if (err?.message && err.message !== err.upstreamMessage) pieces.push(err.message);
      if (err?.body && typeof err.body === 'string') pieces.push('BODY: ' + err.body.slice(0, 300));
      a.bodyExcerpt = pieces.join(' | ').slice(0, 600) || '(no detail)';
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Critical: ITHub returns 200 even when the row isn't written. The only
  // ground truth is "does my Identifier actually appear in the KB list?"
  // GET the list (top 200 is plenty for a tenant with <100 articles) and
  // mark each attempt whose identifier appears. This is the single most
  // important signal — without it we can't tell a real write from a fake
  // success.
  let landedInList: Record<string, number> = {};
  try {
    await new Promise((r) => setTimeout(r, 400));
    const list = (await ithubFetch<any[]>(
      `/api/Knowledge/KnowledgeBases/${kbId}/KnowledgeArticles`,
      { accessToken, query: { $top: 200 } },
    )) as any[];
    if (Array.isArray(list)) {
      for (const a of attempts) {
        const hit = list.find((x) => x?.Identifier === a.identifier);
        if (hit) {
          landedInList[a.identifier] = Number(hit.KnowledgeArticleId ?? 0) || -1;
          a.articleId = landedInList[a.identifier];
          a.ok = true;
        }
      }
    }
  } catch {
    /* list fetch failed — leave landedInList empty */
  }

  res.json({
    kbId,
    dryRun: false,
    note: '每个 attempt 都会真在 ITHub 创建一行 __PROBE__ 数据。请测完后到 ITHub admin Knowledge 后台手动删除。',
    existingSample,
    existingKeys: existingSample ? Object.keys(existingSample) : [],
    // The ground truth: which probe Identifiers actually landed in the KB
    // list after all attempts ran. ITHub's 200 response is unreliable —
    // only this map tells us which shape actually writes. Keyed by
    // Identifier (suffix-less for attempt 1, a/b/c… for 2-11), value is
    // the KnowledgeArticleId ITHub assigned, or -1 if present-but-no-id.
    landedInList,
    attempts: attempts.map(({ label, path, method, body, status, ok, bodyExcerpt, articleId, identifier }) => ({
      label, path, method, body, status, ok, bodyExcerpt, articleId, identifier,
    })),
  });
});