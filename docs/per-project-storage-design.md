# Per-Project Storage 设计文档

> **状态**：设计完成 + Q-10~14 已决议，等待 Sprint A 启动
> **预估工期**：~5 工作日（Sprint A 2d + B 1d + C 2d）
> **关联决策**：`D-13`（Project 一等公民）/ `S-5`（数据本地化）/ `D-18`（per-channel 状态派生）/ `D-1`（Agent 状态派生）
> **新增决策**：`D-21` ~ `D-25`（见 §11）
> **决议状态**：Q-10 ~ Q-14 全部决议（2026-05-08，见 §10）
>
> **重要前提（v0.3）**：项目处于开发阶段，**无需考虑向前兼容，历史数据可清**。
> 因此本文档不再保留 migration 工具、feature flag、Central/PerProject 双实现等
> 防御性设计 — 直接重写 repos 为 per-project，YAGNI 原则。
>
> 本文档对应分支 `feat/per-project-storage`，未合到 `main`。

---

## 1. 背景与动机

### 1.1 现状（截至 commit `0e3d7bf`）

```
~/.openspace/
├── openspace.db          ← 单一 SQLite，全部 projects/channels/agents/messages/
│                       tasks/workflows/decisions/lessons/agent_observations/
│                       agent_feedback/project_onboarding/agent_skills/
│                       workflow_sessions（所有 13 张表都在这里）
├── settings.json     ← 用户级配置（API key / backend）
└── (no per-project storage)
```

所有项目数据共享一个全局 SQLite。`projects.workspace_path` 字段记录代码仓库路径，
但代码仓库本身**完全不知道 OpenSpace 的存在**。

### 1.2 问题

| # | 问题 | 表现 |
|---|------|------|
| P-1 | 项目和数据耦合在 mac 本地 | 换机器丢全部 AI 团队 / 沉淀 |
| P-2 | 团队不能共享 AI 协作设定 | 队友 clone 仓库后看不到任何 agent / lessons |
| P-3 | 删项目不直观 | 必须走 UI Danger Zone API；删仓库后 db 仍残留孤儿数据 |
| P-4 | 心智模型与 Cursor IDE 不一致 | Cursor "open folder" → 配置自然挂；OpenSpace 现在要去 ~/.openspace 找 |
| P-5 | 跨用户协作没基础 | 即使后续上 Marketplace，也没有"一份团队定义文件可分享"的概念 |
| P-6 | 知识沉淀不可读 / 不可 diff | `lessons` / `decisions` 在二进制 db 内，git 不可见 |

### 1.3 目标

**与 Cursor IDE "open folder → 配置自然出现" 心智对齐**：项目特有的数据写在
`<workspace>/.openspace/`，全局只保留用户级偏好（API key、recent projects）。

---

## 2. 目标态结构

### 2.1 文件布局

```
~/.openspace/                           # 用户级（保持现状 + 一个新文件）
├── settings.json                   # ← 现有（Cursor backend / API key）
└── projects.json                   # ← 新：用户开过哪些 project（recent list）

<workspace_path>/.openspace/            # ★ 项目级（全部新增）★
├── project.json                    # 元数据：name / display_name / goal / team_rules / color / created_at
├── openspace.db                        # SQLite：channels/agents/messages/tasks/workflows/runs/responsibilities
├── knowledge/                      # 推荐入 git，团队共享
│   ├── decisions.jsonl             # 决策记录（append-only）
│   ├── lessons.jsonl               # 经验教训
│   └── onboarding.json             # README/git log 自动总结
├── observations/                   # 不入 git，包含个人对话历史片段
│   ├── agent_observations.jsonl
│   └── agent_feedback.jsonl
├── skills/
│   └── agent_skills.json
└── .gitignore                      # 自动写：openspace.db / observations/
```

### 2.2 推荐 git 策略

| 路径 | 入 git | 说明 |
|------|--------|------|
| `<workspace>/.openspace/project.json` | ✅ | Goal / display_name / team_rules — 团队定义 |
| `<workspace>/.openspace/knowledge/*.jsonl` | ✅ | 沉淀的经验，团队共享 |
| `<workspace>/.openspace/onboarding.json` | ✅（可选）| 团队对项目的共同认知 |
| `<workspace>/.openspace/skills/*.json` | ⚠️ 可选 | 偏个人使用习惯 |
| `<workspace>/.openspace/openspace.db` | ❌ | 含个人对话历史 / private message |
| `<workspace>/.openspace/observations/` | ❌ | 包含 evaluator 对个人消息的判断 |
| `<workspace>/.openspace/messages/` | ❌ | 个人聊天历史（如果未来移出 db） |

`.openspace/.gitignore` 自动生成，列出不该入库的项；用户可改。

---

## 3. 数据归属决策表

**核心表 → 存放位置**：

| Table | 现状 | 改造后 | 理由 |
|-------|------|--------|------|
| `projects` | 中心 db | **移除 SQL 表**；改用 `<workspace>/.openspace/project.json` | Project 即文件夹本身；不需要 SQL 行 |
| `channels` | 中心 db | per-project SQLite | 频道隔离 project |
| `channel_agents` | 中心 db | per-project SQLite | 关联表跟着 project 走 |
| `agents` | 中心 db | per-project SQLite | Agent 跟 project 走（已是事实，前面跨 project bug 修复后明确）|
| `messages` | 中心 db | per-project SQLite | 个人对话历史，不入 git |
| `tasks` | 中心 db | per-project SQLite | 任务跟 project |
| `agent_activity` | 中心 db | per-project SQLite | 活动日志 |
| `agent_runs` | 中心 db | per-project SQLite（短时态）| 运行时状态 |
| `workflows` | 中心 db | per-project SQLite + `knowledge/workflows/*.yaml`（双源）| YAML 是事实来源，db 仅用于查询 |
| `workflow_runs` | 中心 db | per-project SQLite | 执行记录 |
| `responsibilities` | 中心 db | per-project SQLite（从 YAML derive） | derive 出的 cache |
| `decisions` | 中心 db | `knowledge/decisions.jsonl` | append-only，git 友好，可 diff |
| `lessons` | 中心 db | `knowledge/lessons.jsonl` | 同上 |
| `agent_observations` | 中心 db | `observations/agent_observations.jsonl` | 含 source_message_id 引用，不入 git |
| `agent_feedback` | 中心 db | per-project SQLite | Coach 提案 |
| `project_onboarding` | 中心 db | `knowledge/onboarding.json` | 单条记录；可入 git |
| `agent_skills` | 中心 db | `skills/agent_skills.json` | 单文件 JSON |
| `workflow_sessions` | 中心 db | per-project SQLite + Facilitator 产出 YAML 落 `knowledge/workflows/` | session 是过渡态，YAML 是产物 |

**关键判断**：
- **JSONL append-only** vs **SQLite 行**：高频改 / 索引复杂 → SQLite；低频改 / 顺序读 / git diff 友好 → JSONL
- **JSON 单文件** vs **JSONL**：单条 / 整体覆写场景 → JSON；多条 / 增量 append → JSONL

### 3.1 全局 `~/.openspace/projects.json` 内容

```json
{
  "version": 1,
  "recent": [
    { "path": "/Users/kaikxiao/aiproject/finClaw", "lastOpened": 1778246924575 },
    { "path": "/Users/kaikxiao/code/openspace",        "lastOpened": 1778160047882 }
  ]
}
```

- 仅记录"用户开过的项目路径"+ 最后访问时间
- 用于 Sidebar Switcher 显示项目列表（不再从 SQL `projects` 表读）
- Open Project Dialog 时追加；Delete Project 时从此移除
- 项目本身的元数据（name / display_name / goal）从 `<path>/.openspace/project.json` 读

---

## 4. 关键挑战与解决方案

### 4.1 全局视图聚合（`/inbox` `/threads` `/tasks`）

**问题**：当前 `/inbox` 端点跨 project 聚合所有 awaiting_approval 的 workflow runs，
SQL 一条 query 搞定；改成 per-project SQLite 后必须**遍历所有打开的项目**。

**解决方案**：

```
启动期：
  → 读 ~/.openspace/projects.json 拿到所有项目路径
  → 对每个 path 打开 <path>/.openspace/openspace.db（SqliteConnectionPool）
  → 维护"打开的项目"映射 ProjectId → DbHandle

GET /api/inbox：
  → for each open project:
       SELECT * FROM workflow_runs WHERE status IN ('awaiting_approval', 'running')
  → 合并 + 按时间排序返回

WebSocket 推送：
  → 每个 project 内部 hub 仍然 per-channel
  → 全局事件（如 inbox 状态变化）broadcast 到所有订阅 inbox 的 client
```

**性能预估**：用户开 10 个项目 → 10 次 SQL query，每次 < 5ms → 总开销 < 50ms。可接受。

### 4.2 现有数据处理（开发阶段）

**v0.3 简化**：项目处于开发阶段，**不写 migration 工具，直接清掉旧数据**。

启动期检测：
```
if (~/.openspace/openspace.db 存在 && ~/.openspace/projects.json 不存在):
  log.warn(`检测到旧版集中存储 db (~/.openspace/openspace.db)。
           OpenSpace 已切到 per-project storage（数据存在 <workspace>/.openspace/）。
           旧数据不会被自动迁移；如需保留请手动备份后删除。`)
  // 不阻塞启动；用户自行处理
```

用户操作建议：
```bash
mv ~/.openspace/openspace.db ~/.openspace/openspace.db.legacy-<date>   # 想留作备份
# 或
rm ~/.openspace/openspace.db                                   # 直接清
```

随后用户在 UI Open Project 时：在该 workspace 内新建 `.openspace/`，
重新 build team / 触发 onboarder。**所有团队定义 / 沉淀从零开始**，符合开发阶段定位。

### 4.3 直接重写 storage（不抽接口）

**v0.3 简化**：YAGNI 原则。不会有第二个 storage 实现需要并存，所以**不抽 ProjectStorage 接口**，
直接重写 `db/index.ts` + `db/repos.ts` 为 per-project handle 形态。

新实现思路：
```typescript
// packages/server/src/db/index.ts（重写）
import Database from 'better-sqlite3';

const handlePool = new Map<string, Database.Database>();

export function openProjectDb(workspacePath: string): Database.Database {
  if (handlePool.has(workspacePath)) {
    return handlePool.get(workspacePath)!;
  }
  const dbPath = path.join(workspacePath, '.openspace', 'openspace.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyPerProjectSchema(db);
  handlePool.set(workspacePath, db);
  return db;
}

export function closeProjectDb(workspacePath: string): void {
  const db = handlePool.get(workspacePath);
  if (db) {
    db.close();
    handlePool.delete(workspacePath);
  }
}
```

`repos.ts` 里所有函数从 `(db: Database, ...)` 不变，调用方改为传 per-project handle
（一般通过 route middleware 注入）。

route handlers 改造：
```typescript
// 旧：app.get('/api/channels', async (req) => { return channelRepo.list(db); });
// 新：app.get('/api/channels', async (req) => {
//       const project = resolveProjectFromRequest(req);  // 从 query 或 path
//       return channelRepo.list(project.db);
//     });
```

全局视图（如 `/inbox`）遍历 handle pool 聚合。

### 4.4 多 db 并发 / 句柄管理

**问题**：用户同时开 N 个项目 → N 个 SQLite 句柄。better-sqlite3 是同步的，
N 大时打开/关闭开销叠加。

**解决方案**：
- 句柄池（Map<projectId, Database>），LRU 淘汰，max=20
- 用户切换 Project 时 lazy open；30 分钟未访问 close
- 全局视图查询临时 open + 用完立刻 close（不进 LRU）

### 4.5 同名项目（重名 slug）

**问题**：用户 open `/path/a/myproj` 和 `/path/b/myproj`，两个 `project.name='myproj'`。

**解决方案**：
- `name` 不再要求全局唯一（D-13 修正版）
- URL 路由 `/p/:projectName` 改为 `/p/:projectId`（不友好）→ 或保留 name + 重名时自动加后缀（保持 OpenProjectDialog 现有 ensureUniqueName 行为）→ **暂不改 URL 结构**，open 时检测 ~/.openspace/projects.json 重名追加 `-2`
- per-project storage 内部用 `projectId`（nanoid）做主键，name 仅展示用

### 4.6 settings 全局 vs 项目隔离

| 字段 | 归属 |
|------|------|
| Cursor backend (cli/sdk) | 全局 `~/.openspace/settings.json` ← 已有 |
| `CURSOR_API_KEY` | 全局 |
| `agent.thinking` `agent.context` `agent.model` | per-project（agents 表） |
| Project goal / team_rules | per-project (`project.json`) |
| Recent projects 列表 | 全局 `~/.openspace/projects.json` |

### 4.7 `lessons` / `decisions` JSONL 格式

```jsonl
{"id":"L-001","kind":"convention","audience":"all","title":"Always wrap async with try/catch","body":"...","source_run_id":12,"review_status":"approved","created_at":1778160000000,"used_count":3}
{"id":"L-002","kind":"gotcha","audience":"backend","title":"...", ...}
```

- append-only，每行一个 JSON 对象
- `id` 改为字符串（`L-001` / `D-001`）方便 git 看 diff
- review_status 修改 = append 一行 `{"id":"L-001","review_status":"approved","at":...}`（事件流），最终态由读取时 fold 决定
- 或 simpler: 直接覆盖整个文件；牺牲 diff 友好换简单实现 — **建议简化版**

---

## 5. API / 路由变化

### 5.1 移除的 API

```
DELETE /api/projects/:id   →  改为 "close project"（从 ~/.openspace/projects.json 移除）
                              真正删除 = 用户手动 rm -rf <workspace>/.openspace/
                              （或保留但额外 confirmation："This will delete .openspace/ in
                              your workspace folder. Continue?"）
```

### 5.2 新增 / 修改的 API

```
POST /api/projects/open
  body: { workspace_path: string }
  → 检查 <path>/.openspace/ 是否已存在
  → 存在：读 project.json + 加入 ~/.openspace/projects.json recent
  → 不存在：mkdir + 初始化（写 project.json + openspace.db schema + .gitignore）
  → 返回 Project

POST /api/projects/close
  body: { project_id }
  → 仅从 recent 列表移除 + 关 db handle；磁盘文件保留

GET /api/projects
  → 从 ~/.openspace/projects.json 读 recent paths
  → for each path: 读 .openspace/project.json
  → 返回数组（含 metadata）

PATCH /api/projects/:id
  → 写 <workspace>/.openspace/project.json
```

### 5.3 ChannelHeader / Sidebar / 全局视图

API 表面**不变**（仍是 `/api/channels`、`/api/agents` 等），只是底层 storage 切换；
前端代码理论上零改动。

---

## 6. Sprint 拆解（v0.3 — 5 工作日）

> **简化原则**：不抽接口、不写 migration、不留 feature flag。直接重写 + 替换。

### Sprint A — Per-Project Storage 重写（2d）

**目标**：核心数据从 `~/.openspace/openspace.db` 切到 `<workspace>/.openspace/openspace.db`。
**完成后状态**：旧 db 不再被读；所有 repo 通过 per-project handle 访问。

任务：
1. **db handle pool**：`db/index.ts` 重写，按 workspace_path 维护连接池（LRU max=20，30min idle close）
2. **schema 改造**：`schema.sql` 移除 `projects` 表（项目元数据存 `project.json`），其余表保留；
   schema_version 重置 / 重命名为 `project-schema-v1`（per-project 内部版本，与全局 v10 解耦）
3. **repos 改造**：所有 `repo.foo(db, ...)` 调用方改为传 per-project db handle；
   移除所有 `WHERE project_id = ?` 过滤（per-project db 内本来就只有一个项目的数据）
4. **route middleware**：新增 `resolveProject(req)` helper，从 query/path/body 解析 workspace_path
   → openProjectDb()
5. **`~/.openspace/projects.json` 维护**：新增 `globalProjectsRepo`（普通 JSON 文件读写）
6. **POST /api/projects/open** 替代 POST /api/projects：检查 `<path>/.openspace/` 是否存在 →
   存在则读 `project.json`；否则 mkdir + 初始化 + 写 `project.json` + 创建 `.gitignore`
7. **DELETE /api/projects/:id** 改为"Close project"（仅从 projects.json 移除 + close handle）
8. **POST /api/projects/:id/delete-storage** 新增：rm -rf `<workspace>/.openspace/`，要求二次确认（Q-11 决议）

**验收**：
- 启动 server 不读旧 `~/.openspace/openspace.db`
- Open Project Dialog 输入新路径 → `<path>/.openspace/` 自动创建 + project.json + openspace.db schema 完整
- 在 channel 内 @ agent 对话能正常 spawn / 持久化到 per-project db

**不在范围**：knowledge JSONL 改造（保留在 per-project SQLite，Sprint C 再迁）；
全局视图聚合（Sprint C）；`.gitignore` 自动写（Sprint C）。

### Sprint B — Project 管理 UX 改造（1d）

**目标**：UI 完整对齐"open folder"心智。

任务：
1. **Welcome / Sidebar 入口**：移除"创建 project（含 build team）"路径；统一走 OpenProjectDialog
2. **Open Project Dialog 增强**：检测 `<path>/.openspace/` 已存在时显示"重新打开"vs"新建"
3. **ProjectSettingsPage Danger Zone 改造（Q-11 决议）**：
   - **Close project**：灰色按钮 + 一键确认 → 仅从 recent 移除
   - **Delete .openspace/**：红色按钮 + 输入项目名验证 → rm -rf `<workspace>/.openspace/`
4. **Sidebar Switcher**：⋯ 菜单加 "Close" 项（与 Settings 并列）
5. **重名处理**：OpenProjectDialog 在 ensureUniqueName 时检查 `~/.openspace/projects.json`
   既有路径，重名追加 `-2`（Q-12 决议）

**验收**：
- 旧路径 + 已有 .openspace/ 的 project Open 时无重复创建
- Close vs Delete 两条路径都正常工作
- 同名 workspace_path 不会创建第二个 project

### Sprint C — 全局视图 + Knowledge JSONL + git 集成（2d）

**目标**：跨 project 聚合视图 + knowledge git-friendly 化 + 自动 `.gitignore`。

任务：
1. **`KnowledgeStore` 实现**：`decisions.jsonl` / `lessons.jsonl` 读写（覆盖式 simpler 版，
   每次操作整体重写文件 — Q-13 简化版决议）
2. **`/api/inbox` `/api/threads` `/api/tasks` 跨 project 聚合**：遍历 handle pool +
   合并排序返回（性能预算 < 100ms / 10 项目）
3. **`<workspace>/.openspace/.gitignore` 自动生成**：默认排 `openspace.db` / `observations/`，
   推荐入库 `project.json` / `knowledge/`
4. **`.openspace/README.md` 自动生成**：解释 `.openspace/` 结构与 git 策略
5. **WS 广播**：knowledge / inbox 变化跨 project 推送（订阅"全局事件"通道）
6. **`docs/technical-decisions.md` D-21~D-25 增补**

**验收**：
- 完整端到端：open folder → 写 .openspace/ → build team → @ agent 对话 → workflow trigger →
  `/inbox` 看到 → `/sediment` 写 lessons.jsonl → git diff 能看到改动
- `.gitignore` 自动写入；`project.json` + `knowledge/` 推荐入库的提示出现在 README

---

## 7. 暂缓 / 下一阶段

| 项 | 原因 |
|---|------|
| 多人协作合并冲突的高级处理（CRDT / OT） | JSONL append-only + last-write-wins 已经够用 |
| 加密 `openspace.db`（含个人对话）| OpenSpace S-5 数据本地化不强制加密；如需 → 系统级 FileVault 即可 |
| Marketplace 共享 .openspace/ 模板 | Sprint D+ 议题 |
| 与 Cursor IDE / VS Code 插件集成 | 需要 IDE extension SDK，远期 |

---

## 8. 风险评估

| # | 风险 | 严重度 | 应对 |
|---|------|--------|------|
| ~~R-1~~ | ~~迁移脚本 bug 导致数据丢失~~ | — | **v0.3 删除**：开发阶段无 migration，旧数据手动清 |
| R-2 | 多 db handle 句柄爆炸 | 🟡 中 | LRU 句柄池 + 30min idle close |
| R-3 | 全局视图性能下降 | 🟡 中 | 性能测：10 project / 1000 messages 每个 → < 100ms |
| R-4 | 用户 `git push` 把含个人对话的 openspace.db 提交 | 🟢 低 | `.openspace/.gitignore` 默认排 openspace.db；自动 README 提示 |
| R-5 | 多 server 实例打开同 project（远期 cloud） | 🟢 低 | SQLite WAL + per-process lock；MVP 不考虑 |

---

## 9. 与现有决策的关系

### 9.1 影响 / 修订的决策

- **`D-13` Project 一等公民** → **修订**：Project 不再是中心 db 的一行，而是文件夹 +
  `<path>/.openspace/`；`project_id` 仍存在但来自 `project.json`
- **`D-1` Agent 状态从 agent_runs 派生** → 不变（agent_runs 表挪到 per-project db）
- **`D-18` per-channel 状态** → 不变
- **`D-15` System Agent 共享约束** → 不变（System Agent 不存 db；prompt 是代码常量）
- **`D-20` 四大运营闭环** → 不变（数据存哪不影响 loops 语义）
- **`S-5` 数据本地化** → 强化（不仅本地，还跟着代码仓库走）

### 9.2 新决策（D-21~D-25）

| # | 决策 | 备注 |
|---|------|------|
| **D-21** | 项目数据归属：所有项目特有数据存 `<workspace>/.openspace/`，不再共享中心 db | 见 §3 表 |
| **D-22** | 全局只保留用户偏好（`~/.openspace/settings.json`）+ recent projects 列表（`~/.openspace/projects.json`）| 见 §2 |
| **D-23** | knowledge 用 JSONL（`decisions` / `lessons`）+ JSON（`onboarding` / `skills`）；运行时数据用 SQLite | git 友好 |
| **D-24** | `.openspace/openspace.db` 默认不入 git；`.openspace/project.json` + `.openspace/knowledge/` 默认入 git | `.gitignore` 自动生成 |
| **D-25** | name 全局不再唯一；`projectId`（nanoid）是真正主键，name 仅展示 + URL 槽 | 重名 OpenProjectDialog 自动 `-2` |

---

## 10. 待决议（Q-10~Q-14）

> **2026-05-08 全部已决议** — 全部按推荐选项落地。

| # | 议题 | 决议 | 选项 |
|---|------|------|------|
| **Q-10 ✅** | `messages` 是否也搬到 JSONL | **仅 SQLite db** | (a) — 高频写 / 复杂查询 / FTS 索引需求 |
| **Q-11 ✅** | 删 Project 默认行为 | **二次确认 dialog**（Close 仅移除 recent / Delete `.openspace/` 带身份验证） | (b) |
| **Q-12 ✅** | URL `/p/:projectName` 重名 | **保留 name 字段 + OpenProjectDialog 自动 `-2` 后缀** | (a) — 不变现有路由 |
| **Q-13 ✅** | `project.json` 是否含 `lastOpened` | **不含**：`lastOpened` 仅在 `~/.openspace/projects.json` 维护，避免 git 冲突 + 个人时间戳泄漏 | (a) |
| **Q-14 ✅** | 同一仓库两个用户同时打开 | **MVP 不处理**：`.openspace/.gitignore` 默认排 `openspace.db`，git push 冲突时提示用户 `git merge`；远期再考虑 sync | (a) |

### 10.1 决议影响：Sprint B "Close vs Delete" 双 dialog

由 Q-11 引入：ProjectSettingsPage Danger Zone 改为两个按钮：

```
[ Close project ]                       (灰色，温和)
   仅从 ~/.openspace/projects.json recent 移除 + 关 db handle
   `.openspace/` 文件夹保留；下次 Open 同 path 立即恢复

[ Delete .openspace/ ]                      (红色，需输入项目名确认)
   级联删除 <workspace>/.openspace/ 整个文件夹
   代码仓库本身不受影响
```

---

## 11. 实施前最终 checklist

- [x] Q-10 ~ Q-14 全部决议（user signoff 2026-05-08）
- [x] feature/per-project-storage 分支已开
- [x] **开发阶段无需向前兼容确认**（user signoff 2026-05-08）— 不写 migration / 不留 feature flag
- [ ] `docs/technical-decisions.md` D-21 ~ D-25 增补（待 Sprint C 收尾时统一同步）

> 旧 db `~/.openspace/openspace.db` 用户自行 `mv` 备份或 `rm` 清掉，server 启动期检测到只 warn 不阻塞。

---

## 12. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.1 | 2026-05-08 | 初版设计：背景 / 目标态 / 数据归属表 / Sprint 拆解 / Q-10~14 |
| v0.2 | 2026-05-08 | Q-10~14 全部决议（user signoff），新增 §10.1 Close vs Delete 双 dialog 设计 |
| v0.3 | 2026-05-08 | 开发阶段简化：删 migration / 不抽 ProjectStorage 接口 / 无 feature flag；工期 9d → 5d；§4.2 重写 / §4.3 重写 / §6 重写 / §8 R-1 删除 / §11 checklist 更新 |
