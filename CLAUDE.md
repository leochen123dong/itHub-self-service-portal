# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

ITHub 智能服务门户 Demo —— 一个面向终端用户的自助 IT 帮助门户。前端 React (Vite + TypeScript，中文 UI)，后端 Express 代理，对接 ITHub REST API (`https://demo.logicalisservice.com/api`，客户标签 `ciscoinnovation1`)。**所有 UI 文本必须是中文**。

完整实施计划：`/Users/leo.chen/.claude/plans/demo-it-valiant-aho.md`（包含 ITHub 端点映射、设计决策、待确认事项）。

## 常用命令

```bash
# 安装（首次）
npm install && (cd server && npm install) && (cd web && npm install)

# 启动前后端（:4000 + :5173，并发）
npm run dev

# 仅后端 / 仅前端
npm run dev:server
npm run dev:web

# 前端构建
npm run build               # 产出 web/dist/

# 后端类型检查
cd server && npx tsc --noEmit

# 前端类型检查 + 构建
cd web && npx tsc --noEmit
cd web && npx vite build

# 后端启动生产模式
cd server && npm run build && npm start
```

冒烟测试脚本（端口在跑时）：
```bash
curl -i http://localhost:4000/api/health
curl -i -c /tmp/c.txt -X POST http://localhost:4000/api/auth/login -H 'Content-Type: application/json' -d '{}'
curl -i -b /tmp/c.txt http://localhost:4000/api/ai/profiles
curl -i -b /tmp/c.txt http://localhost:4000/api/tickets
```

## 架构

### 核心安全模型 — 代理模式

浏览器**永远不接触** AccessToken。后端作为唯一持有 token 的进程：

```
web (Vite dev proxy :5173/api → :4000/api)
  ↓ fetch /api/* with credentials: 'include'  (cookie: sid)
server (Express :4000)
  ↓ 注入 AccessToken header 到上游
ITHub API (demo.logicalisservice.com/api)
```

- `POST /api/auth/login` → 后端调 `POST /api/Security/AccessTokens` → 把 token 存进内存 `Map<sid, SessionData>` → 返回 `HttpOnly; SameSite=Lax` 的 `sid` cookie
- `server/src/session/middleware.ts` 的 `requireSession` 守卫所有业务路由
- session 默认 8 小时过期，每 5 分钟清理
- **不要**把 AccessToken 写进前端代码、URL、localStorage 或 sessionStorage

### 关键文件（读完这几个就能上手）

- `server/src/http/ithubClient.ts` — 唯一接触 ITHub 上游的地方。所有上游调用走它：注入 `customerTag`、`AccessToken`、20s 超时、`502/503/504` 重试 1 次、错误归一为 `ITHubError`。任何新的 ITHub 端点都要在这里或它的调用方复用这个 client。
- `server/src/routes/ai.ts` — AI 相关 13 个路由。三块：**聊天**（`/chat/init`、`/chat/message`、`/chat/suggestions`、`/chat/:id/messages`、`/chats`、rate、ratings）、**管理**（`/admin/stats`、`/admin/kb-usage` — 都过 `requireAdmin`）、**AI 增值**（`/tickets/:id/kb-draft`、`/kb/publish`、`/chat/summarize`）。MiniMax 调用都走 `server/src/ai/minimax.ts` 的 `chatCompletion`。
- `server/src/routes/tickets.ts` — 工单 CRUD。**工单创建**走 `POST /api/ServiceDesk/Customers/{tag}/TicketTemplates/{id}/Ticket{Incidents|Problems|Changes|Requests}` 模式（bare `/api/ServiceDesk/Tickets` 返回 404），需要 `ApiKey` + `AccessToken`。**升级工单**是原子 `POST /escalate`：创建工单 + 同步 chat transcript 到 Journals（自动 0→1 状态转换，因为 ITHub 在 Registered 状态禁止写 journal）。**详情接口**透传 OData `$expand` / `$select`（白名单 + 200 字符限制），让前端探测任意字段。
- `server/src/ai/kbContext.ts` — KB 检索 + 引用追踪。`buildKbContext` 返回 `{ context, refs }`，refs 记录被引用的 article ids，`kbUsageStore` 累计引用次数供 admin 排行。
- `server/src/ai/chatStore.ts` — **服务端** chat 状态（独立于前端的 `web/src/store/chatStore.ts`）。把 ITHub 风格的 `Role/Content` 转为 MiniMax 历史的 `toMiniMaxHistory`。每条 assistant 消息携带 `kbRefs`。
- `server/.env` — **租户切换的唯一入口**。`ITHUB_DEMO_*`、`ITHUB_CUSTOMER_TAG`、`ITHUB_API_KEY`，可选 `AI_PROFILE_ID` / `KB_ID`。注意 `.env` 已被 `.gitignore` 排除，不要 commit 真实凭证。
- `web/src/store/chatStore.ts` — 前端 AI 聊天状态机 + 升级工单的核心。`escalateToTicket()` 是"一键转人工"：先 `POST /api/ai/chat/summarize` 让 MiniMax 把对话压成 ≤50 字中文摘要（失败降级到原"最后 6 条拼接"）→ `POST /api/tickets/escalate`（一个原子调用 = 创建工单 + chatTranscript 同步到 Journals）。`escalating` 状态控制按钮文案。
- `web/src/components/TicketTimeline.tsx` — Journal 渲染。`stripHtml` 处理 ITHub 返回的 HTML 包裹（`<p>/<br>`）+ 双重 HTML 实体编码（**含 hex entity `&#x5B89;`** — 必须按 base-16 解码，不能只解 `&#(\d+);`）。
- `web/src/components/KbDraftModal.tsx` — AI 总结工单 → KB 草稿 → 发布 的模态框。发布失败时显示上游错误 + 一键复制草稿。
- `web/src/components/AdminStatsWidget.tsx` — admin 评分 + KB 引用排行 + 从未引用的 KB（ChatPage 底部）。
- `web/src/pages/ChatPage.tsx` — Demo 主舞台。"转人工"按钮固定在输入栏右侧。

### 数据流（闭环路径）

1. 用户登录 → `POST /api/auth/login` → 后端存 session → cookie 返回
2. 进 AI 助手 → `chatStore.initChat()` → `POST /api/ai/chat/init`（后端 → `InitiateAIChat`）
3. 发送消息 → `POST /api/ai/chat/message`（后端 → `AIChats/UserMessage`）→ 返回 `Messages` + `SuggestedActions`
4. 点 "转人工" → 确认弹窗 → `chatStore.escalateToTicket()` → `POST /api/ai/chat/summarize`（拿 ≤50 字 AI 摘要）→ `POST /api/tickets/escalate`（创建工单 + 完整对话 HTML 同步到 Journals，**不**回滚工单，journal 失败返回 `journalError` 字段让前端 toast 提示）→ 跳 `/tickets/:id`
5. 详情页 → `GET /api/tickets/:id` + `GET /api/tickets/:id/journals`（每 20s 轮询一次以反映 admin 端状态变更） → TicketTimeline 渲染
6. 加备注 → `POST /api/tickets/:id/journals`（自动 0→1 状态转换）
7. 总结工单为 KB（详情页 → "生成 KB 草稿" 按钮）→ `POST /api/ai/tickets/:id/kb-draft` → 模态框编辑 → `POST /api/ai/kb/publish`（3 种字段命名 fallback，全失败返回 `upstreamErrors` + `draft` 让前端"复制草稿"兜底）

### 模块边界

- **后端**：每个路由文件一个域（auth / ai / kb / catalog / tickets / health）。新增端点 → 在 `routes/` 加文件 → 在 `index.ts` 挂载。
- **后端 AI 子模块**：`server/src/ai/` 放与 AI/MiniMax 相关的非路由代码 —— `minimax.ts`（MiniMax API 包装 + 重试/超时）、`chatStore.ts`（服务端 chat 状态）、`kbContext.ts`（KB 检索 + 引用追踪）、`kbUsageStore.ts`（引用排行）、`ratingStore.ts`（评分聚合）。
- **前端 API 层**：`web/src/api/{auth,ai,kb,catalog,tickets}.ts` 镜像后端域，`api/client.ts` 提供 `api.get/post/put/del` 包装（自动 `credentials: 'include'`、自动抛 `ApiError` 含中文 `message_zh`）。
- **前端状态**：仅 3 个 zustand store（`authStore`、`chatStore`、`uiStore`）。其他页面数据用 `useState` + 组件内 fetch，无需全局缓存。
- **前端组件**：手写轻量组件，不引 Ant Design / MUI。Markdown 用 `ChatMessage.tsx` 自写的 ~30 行渲染器。

## 切换租户 / 重新 Demo

只改 `server/.env`（本地）或 Render Environment（线上）：`ITHUB_CUSTOMER_TAG`、`ITHUB_DEMO_IDENTITY`、`ITHUB_DEMO_PASSWORD`，可选 `AI_PROFILE_ID`、`KB_ID`。重启后端即生效，前端无需改动。

## 部署

线上 Demo 跑在 GitHub Pages（静态前端）+ Render（Express 后端）。完整步骤见 [DEPLOY.md](DEPLOY.md)。

```
浏览器
  ↓ https://leochen123dong.github.io/itHub-self-service-portal/
GitHub Pages (web/dist/)
  ↓ fetch https://ithub-portal-server.onrender.com/api/*
Render (server/)
  ↓ + AccessToken header
https://demo.logicalisservice.com/api
```

部署相关文件：
- `render.yaml` — Render Blueprint，声明服务名 `ithub-portal-server`、build/start 命令、健康检查 `/api/health`、env 变量。
- `.github/workflows/deploy-web.yml` — push to main → `npm ci` → `npm run build`（注入 `VITE_BASE_PATH: /${{ github.event.repository.name }}/` 和 `VITE_API_BASE: ${{ secrets.VITE_API_BASE }}`）→ `actions/deploy-pages@v4`。
- `web/vite.config.ts` — `base` 用 `VITE_BASE_PATH` 控制，dev 时默认 `/`。
- `web/src/main.tsx` — **用 HashRouter**（不用 BrowserRouter），GH Pages 静态托管没有 SPA rewrite。
- `web/public/404.html` — 直接刷新深链时兜底跳回首页。
- `server/src/config.ts` — `webOrigins: string[]`，支持 `WEB_ORIGIN=a,b,c` 逗号分隔多个 origin（CORS）。`hasExternalOrigin` 决定 cookie 是否用 `SameSite=None; Secure`（跨站部署时强制 https）。
- `server/src/index.ts` — CORS 用 function 校验 origin 数组，含 `credentials: true`。

**部署约定**：
- 前端：push 到 main 触发 GH Pages 自动部署（无需手动操作）
- 后端：Render 需要在 Dashboard 手动点 **Manual Deploy** —— 改完代码后要主动去 `dashboard.render.com` 拉新版本
- GitHub secret 只需一个：`VITE_API_BASE` = `https://ithub-portal-server.onrender.com/api`（**以 `/api` 结尾，无尾斜杠**）。Render 那边的 `WEB_ORIGIN` 要包含 `https://leochen123dong.github.io`（**不要漏 https**）。