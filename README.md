# OpenSpace

> **Programmable AI Team OS** — 本地可编程 AI 团队操作系统。
> Agent 能力由 **Cursor CLI / Cursor SDK / Codex CLI** 驱动，无需 MCP、数据 100% 本地存储在每个项目自己的 `.openspace/` 目录下。

## ✨ 特性
### 隐私安全。数据完全自己掌握，不经过第三方
### 团队 AI 协作

## 🚀 快速开始

### 一行部署

推荐用宿主机安装模式部署 OpenSpace，这样可以直接复用本机已登录的 Codex CLI / Cursor CLI：

```bash
curl -fsSL https://raw.githubusercontent.com/jeromeyangtao/openspace/main/scripts/install.sh | bash
```

安装脚本会把应用安装到 `~/.openspace/app`，数据放在 `~/.openspace`，构建完成后用 PM2 常驻启动：

```bash
# 访问
http://127.0.0.1:4179

# 常用管理
pm2 logs openspace
pm2 restart openspace --update-env
pm2 stop openspace
```

可选环境变量：

```bash
OPENSPACE_INSTALL_DIR=~/.openspace/app      # 应用安装目录
OPENSPACE_HOME=~/.openspace                 # 全局数据目录
OPENSPACE_DEFAULT_WORKSPACE=~/code/project  # 首次启动默认打开的 workspace
OPENSPACE_HOST=127.0.0.1
OPENSPACE_PORT_SERVER=4179
OPENSPACE_REF=main
```

### 前置

- **Node.js ≥ 20**, **pnpm ≥ 10**
- 至少一个本地 coding runtime 已安装并登录：
  - **Codex CLI** (`codex`)
  - **[Cursor CLI](https://cursor.sh)** (`cursor-agent`)，或在 Settings 中配置 Cursor SDK API key 改走 SDK 旁路
  - 其他 runtime（Claude / Kimi / Copilot / Gemini）在 UI 中标为 "coming soon"

### 本地启动

```bash
pnpm install
pnpm dev                # 并发启动前后端

# 然后访问
# → http://localhost:4178   前端 UI
# → http://127.0.0.1:4179   后端 API + WebSocket
```

### 生产单进程启动

```bash
pnpm install
pnpm build

pnpm start

# 然后访问
# → http://127.0.0.1:4179
```

生产模式下，Fastify 后端会自动托管 `packages/web/dist`，`/api/*` 和 `/ws` 仍由后端处理，其余路径回退到前端 `index.html`。

如果不使用一行安装脚本，也可以手动用 PM2 常驻：

```bash
pnpm install
pnpm add -g pm2
npm run deploy
pm2 save
pm2 startup
```

常用管理命令：

```bash
pnpm pm2:logs
npm run deploy
pnpm pm2:stop
```

PM2 配置在 `ecosystem.config.cjs`，默认把 `OPENSPACE_HOME` 设为 `/var/lib/openspace`。

首次启动时如果 `OPENSPACE_HOME/projects.json` 里还没有任何项目，OpenSpace 会自动把当前进程工作目录作为默认 workspace 打开，并在其中创建 `.openspace/`。可以用 `OPENSPACE_DEFAULT_WORKSPACE=/path/to/workspace` 覆盖这个默认目录。

`OPENSPACE_HOST` 默认是 `127.0.0.1`，`OPENSPACE_PORT_SERVER` 默认是 `4179`，普通部署不需要显式传。

`OPENSPACE_WEB_ORIGIN` 默认是 `https://openspace.hermes-inc.com`。如果你部署到其他域名，再显式覆盖它。

首次启动会：

- 在 `~/.openspace/projects.json` 维护项目登记表（**不再**预置任何 Project / Channel / Agent）
- 浏览器打开 → **Welcome 页**引导 `+ Open project folder`
- 选择 workspace 路径 → 自动在 `<workspace>/.openspace/` 创建 `project.json` + `openspace.db` + `.gitignore` + `README.md`，并 seed 一个 `#general` 频道
- 进入 Project Settings 填 Goal → Team Architect 推荐团队 → Approve 即用

> 数据 100% 落到你选的 workspace 里。想跟团队共享 Workflow / 知识沉淀？把 `.openspace/knowledge/*.jsonl` 入仓即可（`openspace.db` 默认 ignore）。

### 常用命令

```bash
pnpm dev             # 并发启动前后端
pnpm dev:web         # 仅前端（Vite @ 4178）
pnpm dev:server      # 仅后端（Fastify + tsx watch @ 4179）

pnpm build           # 递归构建所有 packages
pnpm start           # 生产模式：启动后端并托管 packages/web/dist
pnpm pm2:start       # PM2 后台启动生产服务
pnpm typecheck       # 递归类型检查
pnpm lint            # ESLint
pnpm format          # Prettier
```

### 快捷键

- `⌘/Ctrl + K` — 全局搜索
- `Enter` — 发送消息
- `⌘/Ctrl + Enter` — 多行字段保存（Agent Profile 内联编辑等）
- `Esc` — 关闭对话框

## 🏗️ 架构

```
┌──────────────┬─────────────────────┬────────────────────┐
│  Web (React) │  WebSocket + REST   │  Server (Fastify)  │
│  4178        │  ← → + /api/*       │  4179              │
└──────────────┴─────────────────────┴────────────────────┘
                                               │
                                               ↓
        ┌──────────────────────────────┬────────────────────┐
        │  Per-Project Storage         │  CLI Bridge        │
        │  ~/.openspace/projects.json      │  codex / cursor    │
        │  <workspace>/.openspace/         │  spawn + NDJSON    │
        │    ├── project.json          │  + Cursor SDK 旁路 │
        │    ├── openspace.db              │                    │
        │    └── knowledge/*.jsonl     │                    │
        └──────────────────────────────┴────────────────────┘
```

### 五个核心模块

- **M1 — CLI Bridge** (`packages/server/src/agents/`) 替代 MCP，通过 `spawn + NDJSON` 与 CLI 工具通信，并提供 Cursor SDK 直连旁路
- **M2 — Agent Engine** 上下文构建（description + 团队列表 + 对话历史 + token 预算裁剪）+ 状态机
- **M3 — Message Bus** (`packages/server/src/messaging/`) WebSocket + @mention 解析 + 链式触发 + Thread 管理
- **M4 — Data Layer** (`packages/server/src/db/`、`packages/server/src/config/`) Per-Project SQLite (LRU handle pool) + projects.json 登记 + knowledge jsonl
- **M5 — Frontend UI** (`packages/web/src/`) React 19 + Tailwind v4 + Zustand + Radix

## 📂 目录结构

```
openspace/
├── packages/
│   ├── web/              # React 19 + Vite + Tailwind v4 前端
│   ├── server/           # Fastify + ws + better-sqlite3 后端
│   └── shared/           # 前后端共享类型、常量、事件协议
├── spike/                # Phase 0 CLI Bridge 技术验证产物
├── docs/
│   ├── product-brief.md          # 战略层文档
│   ├── technical-decisions.md    # 默认技术决策
│   ├── per-project-storage-design.md  # Per-project 存储设计
│   ├── cli-event-format.md       # CLI 事件格式对照
│   ├── cursorsdkadapter.md       # Cursor SDK 旁路调研
│   └── ui-reference/             # UI 视觉基准规范
├── PLAN.md               # 战术执行计划（当前 + 未来 Sprint）
├── pnpm-workspace.yaml
└── package.json
```

## 📖 核心文档

| 文档 | 用途 |
|------|------|
| [PLAN.md](PLAN.md) | 战术执行计划 — 当前 + 未来 Sprint 的范围与验收 |
| [docs/product-brief.md](docs/product-brief.md) | 战略层：产品定位 / 目标用户 / 核心决策 / 非目标 |
| [docs/technical-decisions.md](docs/technical-decisions.md) | 状态机、Token 预算、并发、错误 UI、per-project 存储等默认决策（D-N） |
| [docs/per-project-storage-design.md](docs/per-project-storage-design.md) | Per-project SQLite + knowledge jsonl 存储设计 v0.3 |
| [docs/cursorsdkadapter.md](docs/cursorsdkadapter.md) | Cursor SDK 旁路 / Hooks / Subagents 调研条目（S-N） |
| [docs/cli-event-format.md](docs/cli-event-format.md) | 三个 CLI 的事件格式对照 |
| [docs/ui-reference/README.md](docs/ui-reference/README.md) | UI 视觉基准规范（4 份） |
| [spike/README.md](spike/README.md) | Phase 0 CLI 验证结果总结 |

### 开发流程

```bash
# 1. fork + clone
git clone git@github.com:<your-username>/openspace.git
cd openspace
pnpm install

# 2. 起新分支（建议 feat/<topic>、fix/<topic>、docs/<topic>）
git checkout -b feat/your-feature

# 3. 改代码 + 跑检查
pnpm typecheck      # 必须全绿
pnpm lint           # 建议全绿
pnpm format         # Prettier 自动格式化

# 4. 本地跑一遍 smoke
pnpm dev            # 起前后端，手动验你改的那块

# 5. commit + push + PR
git commit -m "feat(scope): your concise message"
git push origin feat/your-feature
# → 在 GitHub 上提 PR
```