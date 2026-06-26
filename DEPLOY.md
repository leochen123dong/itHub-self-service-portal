# 部署指南

把 Demo 部署到 GitHub + Render，从任何电脑访问同一 URL 即可演示。

## 架构

```
浏览器
  ↓ https://leochen123dong.github.io/itHub-self-service-portal/
GitHub Pages（静态前端，web/dist/）
  ↓ fetch https://ithub-portal-server.onrender.com/api/*
Render（Express 后端，server/）
  ↓ + AccessToken header
https://demo.logicalisservice.com/api
```

## 已完成的设置（无需重复操作）

| 组件 | 状态 | URL |
|---|---|---|
| GitHub 仓库 | Public | <https://github.com/leochen123dong/itHub-self-service-portal> |
| GitHub Pages | 已启用（workflow source） | <https://leochen123dong.github.io/itHub-self-service-portal/> |
| `.github/workflows/deploy-web.yml` | push to main 自动构建 | — |
| `render.yaml` Blueprint | 待首次部署时引用 | — |

## 你需要做的（一次性，~10 分钟）

### 1. 在 Render 部署后端

1. 打开 <https://dashboard.render.com/blueprints>
2. 点 **New Blueprint Instance** → 选这个 repo (`leochen123dong/itHub-self-service-portal`)
3. Render 读 `render.yaml`，会创建一个 free web service 叫 `ithub-portal-server`
4. 等首次部署完成（~2-3 分钟），记下 URL，形如 `https://ithub-portal-server.onrender.com`
5. 进 service 的 **Environment** 页，设置以下环境变量：

   | 变量 | 值 |
   |---|---|
   | `WEB_ORIGIN` | `http://localhost:5173,https://leochen123dong.github.io` |
   | `ITHUB_BASE_URL` | `https://demo.logicalisservice.com` |
   | `ITHUB_CUSTOMER_TAG` | `ciscoinnovation1` |
   | `ITHUB_DEMO_IDENTITY` | 你的演示账号邮箱 |
   | `ITHUB_DEMO_PASSWORD` | 演示账号密码 |
   | `AI_PROFILE_ID` | （可选，AI Profile ID） |
   | `KB_ID` | （可选，知识库 ID） |

   保存后 Render 会自动重启。

### 2. 把 Render URL 配置到前端

1. 进 GitHub repo **Settings → Secrets and variables → Actions**
2. 点 **New repository secret**，名称 `VITE_API_BASE`，值填 `https://ithub-portal-server.onrender.com/api`（**以 `/api` 结尾，不要带尾斜杠**）
3. 任意 push 到 main 触发重新部署（或在 Actions 页面手动 `workflow_dispatch`）

### 3. 验证

- 打开 <https://leochen123dong.github.io/itHub-self-service-portal/>
- 第一次访问会等 ~30 秒（Render 免费层从休眠唤醒）
- 登录页应该能正常登录；登录后能正常使用 AI 聊天 / 知识库 / 工单

## 关键文件说明

| 文件 | 作用 |
|---|---|
| `render.yaml` | Render Blueprint 定义：构建/启动命令、Node 版本、env 变量声明 |
| `.github/workflows/deploy-web.yml` | push to main → npm ci → npm run build → actions/deploy-pages |
| `web/vite.config.ts` | `VITE_BASE_PATH` 自动跟随 `github.event.repository.name` |
| `web/src/main.tsx` | 用 `HashRouter`，GitHub Pages 不需要 SPA rewrite |
| `web/public/404.html` | 兜底：直接刷新深链时跳回首页 |
| `server/src/index.ts` | CORS 支持逗号分隔的多 origin（`WEB_ORIGIN=a,b,c`） |
| `server/src/config.ts` | `webOrigins: string[]`，按数组校验 |

## 故障排查

- **页面打开但登录失败 401**：后端凭证不对，进 Render Environment 检查 `ITHUB_DEMO_*`
- **页面打开但 CORS 报错**：检查 Render 的 `WEB_ORIGIN` 是否包含 `https://leochen123dong.github.io`（**不要漏 https**）
- **第一次很慢（30s+）**：Render 免费层 15 分钟无活动后会休眠，下次请求要唤醒。生产环境考虑升级到 Starter plan ($7/月)
- **改了 workflow 没生效**：进 repo 的 **Actions** 页查看是否有报错；黄色/红色❌的 run 说明构建失败
- **想换部署平台**：`web/vite.config.ts` 的 `base` 用 `VITE_BASE_PATH` 控制；Render 部分可以独立替换成 Railway/Fly.io/任何支持 Node 的 PaaS

## 本地开发（不需要部署也能跑）

```bash
npm install
(cd server && npm install)
(cd web && npm install)
cp server/.env.example server/.env  # 编辑填凭证
cp web/.env.example web/.env        # 默认 VITE_API_BASE=/api 即可
npm run dev
```

打开 http://localhost:5173。Vite 把 `/api/*` 代理到本地的 `:4000`。