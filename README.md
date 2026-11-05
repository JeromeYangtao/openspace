# OpenSpace

> **Programmable AI Team OS** — 本地可编程 AI 团队操作系统。
> Agent 能力由 **Cursor CLI / Cursor SDK / Codex CLI / Claude Agent SDK** 驱动，无需 MCP、数据 100% 本地存储在每个项目自己的 `.openspace/` 目录下。

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
OPENSPACE_PNPM_VERSION=10
```

### 前置

- **Node.js 22.14+（22.x）或 ≥ 23.6**，推荐 Node.js 24；**pnpm ≥ 10**。`better-sqlite3` 13 使用 [Node-API 10](https://nodejs.org/api/n-api.html#node-api-version-matrix)，旧版 Node 22 不兼容。
- 至少一个本地 coding runtime 已安装并登录：
  - **Codex CLI** (`codex`)
  - **[Cursor CLI](https://cursor.sh)** (`cursor-agent`)，或在 Settings 中配置 Cursor SDK API key 改走 SDK 旁路
  - **Claude Agent SDK**（安装依赖时自带执行文件），配置 `ANTHROPIC_API_KEY` 后使用
  - 其他 runtime（Kimi / Copilot / Gemini）在 UI 中标为 "coming soon"

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

### Agent 权限确认

Agent 默认直接执行已授权范围内的常规读取、工作区编辑和测试，仅在缺少权限、未授权的破坏性操作或关键意图不明确时询问。

Codex 使用 `on-request` + `auto_review`：保留工作区写入沙箱和联网限制，越界请求先交给 Codex 自动审核，通过后继续执行。自动审核拒绝时，Agent 应尝试安全替代方案，或说明原因并请求缺少的授权；这不保证每次拒绝都会弹出审批卡片。运行时仍发给 OpenSpace 的审批请求会继续显示审批卡片，可选择单次批准、会话内批准或批准规则。

需要支持 `auto_review` 的 Codex app-server（本地验证协议版本：`codex-cli 0.156.1`）。若使用旧版本或希望所有审批请求都手动处理，可设置 `OPENSPACE_CODEX_APPROVALS_REVIEWER=user` 并重启服务。显式配置的 Workflow 审批步骤仍需确认。

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
│   ├── project-plan.html         # 项目规划在线 HTML
│   └── ui-reference/             # UI 视觉基准规范
├── pnpm-workspace.yaml
└── package.json
```

## 📖 核心文档

| 文档 | 用途 |
|------|------|
| [docs/project-plan.html](docs/project-plan.html) | 项目规划 — 当前状态、架构、近期验收重点 |
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

### Goal 持续执行（test 分支）

在频道中发送 `/goal <目标>`，或指定负责人 `@agent /goal <目标>`。首版支持频道内的 Codex Agent；多个可用 Agent 时会打开负责人选择表单。单独发送 `/goal` 打开创建表单，也可点击频道 Goals 区域的“新建 Goal”。

Goal 在专属线程里执行，未完成自动继续，完成候选经过单独验证轮后才结束。卡片显示负责人、验收进度、轮数、累计运行时间及停止原因；点击“打开线程”查看执行回复，点击目标查看要求、证据与执行记录。

追加要求有三种方式：在 Goal 线程直接发消息、点击卡片“补充要求”，或使用 `/goal-update <goal-id> <补充要求>`（在线程可省略 id）。运行中的 Goal 会先停止旧轮次，再按新要求继续；已暂停的 Goal 只保存要求，点击“继续”后恢复。使用 `/comment` 发送不影响执行的旁注。

支持 `/goal-status`、`/goal-pause`、`/goal-resume`、`/goal-cancel`；线程外存在多个 Goal 时需指定 id。默认总额度 20 轮、60 分钟累计运行时间，等待审批/输入不计时；额度用尽后在“继续”表单增加总额度。暂停或取消不会回滚已产生的修改。服务重启后，不确定是否完成的旧轮次暂停，待用户恢复，避免重复外部操作。

`OPENSPACE_GOALS_ENABLED=false` 可关闭新建并暂停已有执行。每个 OpenSpace home 只允许一个调度服务进程，相同 workspace 的 Goal 串行执行。Goal 与项目设置的 Goal 字段独立；同名 Workflow 命令冲突需更名，也可通过表单创建。完成证据由 Agent 提供并在验证轮复核，不等同于人工代码审查。

### Claude Agent（第一版）

1. 运行 `pnpm install`，保留 optional dependencies（SDK 自带平台对应的 Claude 执行文件）。
2. 在服务进程环境中设置 `ANTHROPIC_API_KEY` 并重启服务；也可以在创建 Agent 的 Environment Variables 中为单个 Agent 配置。不要把密钥提交到代码库。
3. 创建 Agent，选择 **Claude Agent**，模型选择 `sonnet`、`opus` 或 `haiku`。这些是 Claude 官方模型别名，具体可用性由账号决定。
4. 在频道中 @Agent。工具权限和用户提问使用已有审批/输入卡片，停止按钮会取消运行并清理待处理请求。

支持流式文本、思考、工具调用结果，以及按项目、Agent、频道隔离的持久会话。只发送本次消息，恢复时不重复注入历史。会话记录由 SDK 保存在本机，OpenSpace 数据库保存会话 ID；删除 SDK 的会话文件会导致恢复失败并显示错误。

采用 SDK `default` 权限模式，保留 Claude Code 默认系统提示词并加载项目 `.claude/settings.json` / `CLAUDE.md`。工具按 Claude 的权限规则执行，需要人工确认的操作转交 OpenSpace；“Allow for session”仅把 SDK 建议规则用于当前运行进程，不写项目权限文件，下一轮仍可能再次询问。后台系统 Agent 没有交互界面时拒绝需要人工确认的操作。可设置 `OPENSPACE_SYSTEM_RUNTIME=claude`，同时给服务配置 API Key。

第一版要求 API Key，不自动复用 claude.ai 订阅登录。上下文窗口使用模型默认值，暂不支持 OpenSpace 手动压缩和上下文用量面板。模型调用需要联网；SDK 版本锁定在 server 的 package.json 和 pnpm-lock.yaml。
