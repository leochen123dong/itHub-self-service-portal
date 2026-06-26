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
npm run build && npm start  # 注意：web 构建产物没自动被 server 提供，目前 demo 只用 dev
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

- `server/src/http/ithubClient.ts` — 唯一接触 ITHub 上游的地方。所有上游调用走它：注入 `customerTag`、`AccessToken`、15s 超时、`502/503/504` 重试 1 次、错误归一为 `ITHubError`。任何新的 ITHub 端点都要在这里或它的调用方复用这个 client。
- `server/src/routes/ai.ts` — AI 聊天的 4 个路由。注意 `UserAIChatContext` 枚举值：`None=0`、`Ticket=2`、`KnowledgeArticle=5`。`/chat/init` 根据 body 是否带 `knowledgeArticleId`/`ticketId` 选不同的上游端点。
- `server/.env` — **租户切换的唯一入口**。`ITHUB_DEMO_*`、`ITHUB_CUSTOMER_TAG`、可选 `AI_PROFILE_ID` / `KB_ID`。注意 `.env` 已被 `.gitignore` 排除，不要 commit 真实凭证。
- `web/src/store/chatStore.ts` — **闭环逻辑所在**。`escalateToTicket()` 是"一键转人工"的核心：先 `POST /api/tickets/by-checkpoint`（checkpoint = `AIChat:<chatId>`）拿模板项，再 `POST /api/tickets` 创建。失败时 fallback 直接 POST 一个最小 payload。
- `web/src/pages/ChatPage.tsx` — Demo 主舞台。"转人工"按钮固定在输入栏右侧。

### 数据流（闭环路径）

1. 用户登录 → `POST /api/auth/login` → 后端存 session → cookie 返回
2. 进 AI 助手 → `chatStore.initChat()` → `POST /api/ai/chat/init`（后端 → `InitiateAIChat`）
3. 发送消息 → `POST /api/ai/chat/message`（后端 → `AIChats/UserMessage`）→ 返回 `Messages` + `SuggestedActions`
4. 点 "转人工" → 确认弹窗 → `chatStore.escalateToTicket()` → `POST /api/tickets/by-checkpoint` → `POST /api/tickets` → toast + 顶部 banner 显示工单号
5. 点 toast "查看" → 跳 `/tickets/:id` → `GET /api/tickets/:id` + `GET /api/tickets/:id/journals` → 时间线渲染
6. 加备注 → `PUT /api/tickets/:id`（body 含 `TicketJournals` 数组）

### 模块边界

- **后端**：每个路由文件一个域（auth / ai / kb / catalog / tickets / health）。新增端点 → 在 `routes/` 加文件 → 在 `index.ts` 挂载。
- **前端 API 层**：`web/src/api/{auth,ai,kb,catalog,tickets}.ts` 镜像后端域，`api/client.ts` 提供 `api.get/post/put/del` 包装（自动 `credentials: 'include'`、自动抛 `ApiError` 含中文 `message_zh`）。
- **前端状态**：仅 3 个 zustand store（`authStore`、`chatStore`、`uiStore`）。其他页面数据用 `useState` + 组件内 fetch，无需全局缓存。
- **前端组件**：手写轻量组件，不引 Ant Design / MUI。Markdown 用 `ChatMessage.tsx` 自写的 ~30 行渲染器。

## 开发注意事项

- ESM：`server/package.json` 和 `web/package.json` 都设了 `"type": "module"`，导入要带 `.js` 后缀（即使源文件是 `.ts`），tsconfig `moduleResolution: "Bundler"`。
- TypeScript 严格模式开。async 路由 handler 显式声明 `Promise<void>` 返回类型（已在所有 handler 统一）。
- 前端响应字段命名遵循 ITHub PascalCase（`TicketId`、`AIChatId`、`TicketState`）。`TicketForm.tsx` 用 `def.Name || def.PropertyName || def.Key` 等兜底匹配多种 schema。
- 错误归一：上游 4xx/5xx 已经被 `ithubClient` 转 `ITHubError`，路由层翻译成 `{error: {code, message_zh}}` 返给前端。前端 `ApiError` 直接展示 `message_zh`。
- 启动期发现：服务启动时**不会**自动 discover AI Profile / KB（计划里写了但没实现）。当前依赖 `.env` 显式配置 `AI_PROFILE_ID` / `KB_ID`。如果需要自动发现，加在 `server/src/config.ts` 启动 hook 中。

## 切换租户 / 重新 Demo

只改 `server/.env`：`ITHUB_CUSTOMER_TAG`、`ITHUB_DEMO_IDENTITY`、`ITHUB_DEMO_PASSWORD`，可选 `AI_PROFILE_ID`、`KB_ID`。重启后端即生效，前端无需改动。