# OpenSpace 产品定位与目标需求

> 本文档是 OpenSpace 的**战略层文档**，回答 "OpenSpace 是什么 / 为谁做 / 不做什么"。
> `docs/project-plan.html` 回答 "当前状态 / 怎么分阶段做"，`docs/technical-decisions.md` 回答 "具体实现约束"。
> 三层文档的所有变更都必须与本文档一致；冲突时以本文档为准。

## 文档来源与版本说明

本文档沉淀自 2026-04-22 ~ 2026-04-23 关于产品最终定位的多轮讨论。

### 历次校准

| 版本 | 关键校准 |
|------|---------|
| v0.1 | 初版："Channel 即 Project" 简化模型 |
| v0.2 | **Server = Project**（channels 从独立实体降级为 Project 内话题频道）|
| v0.3 草案 | 聚焦编程协作 / 砍掉自主学习型 Agent / Agent 无独立 workspace |
| **v1.0** | **产品定位升级**：从 "AI 员工聊天室" 跃升为 **"Programmable AI Team OS"**。引入 6 层架构 / 4 个运营闭环 / 6 个系统 Agent / 从 Goal 自动推导 Team / Team 协同设计 Workflow |

v1.0 是一次本质跃迁：**OpenSpace 不再只是"Slack UI for AI"，而是一个可编程的 AI 团队操作系统**。Slack 式聊天室只是它的 UI 入口，真正的产品是背后的**运营机制**。

---

## 1. 产品一句话

> **OpenSpace = Programmable AI Team OS —— 可编程的 AI 团队操作系统。**
>
> **你设定目标，AI 自动配备团队，团队自己设计协作流程，系统持续沉淀经验并让每个 Agent 随项目成长。**

### 四个关键动作

```
Goal (用户输入)
  ↓ AI 推导
Team (AI 自动配备)
  ↓ 协同设计
Workflow (Team 自己讨论出"甬道")
  ↓ 执行 + 沉淀
Knowledge (沉淀集体智慧)
  ↓ 反馈
Capability (每个 Agent 持续进化)
```

**四个动作都由 AI 主导，人只在关键节点 Approve**。这是 OpenSpace 的核心差异化。

### 视觉锚点

继承 slock.ai 的 Neo-Brutalism 暖黄配色 + 硬阴影 + 2px 黑边。详见 `docs/ui-reference/design-tokens.md`。

---

## 2. 愿景与成功标准

### 愿景

让 "运营一个 AI 工程团队" 像**打开一个 IDE** 一样自然：
- 设定目标 → AI 帮你组建最合适的团队
- Team 自己讨论如何协作 → 你只需要 Approve 最终方案
- 项目跑起来 → 经验自动沉淀 → 团队越用越强
- 整个过程像带一个不断成长的真人团队，而不是每次重新招新员工

### 成功标准

| # | 描述 | 衡量方式 |
|---|------|---------|
| S-1 | 从 Welcome 页到"发出第一条 @ 消息" ≤ 3 分钟 | **起点**：访问 `http://localhost:4178/` 看到 Welcome 页；**终点**：点击第一条消息的 Send 按钮。全流程由同一个用户完成 |
| S-2 | **两个同名 Agent（各自归属不同 Project）** 并发工作时，对话 / Tasks / Threads / Knowledge 完全隔离 | 并发跑 2 个 Project + 人工抽检（注：v1.0 不做跨 Project Agent 复用，见 §8 N-13）|
| S-3 | Agent 能在当前 channel 对应的代码仓库里直接读写文件 | cwd = `project.workspace_path` 生效 |
| S-4 | 声明式 Workflow（YAML）可以执行成一个完整 thread：触发 → 分步 → 路由 → 完结 | 用内置 `feature-development` 模板跑通一个 feature |
| S-5 | 所有数据本地化，用户可以离线使用（CLI 工具本身的 API 调用除外） | 数据目录 `~/.openspace/` 无上行网络 |
| S-6 | 用户连续使用 3 个月后，Agent 团队交付质量可观测地提升 | `agent_feedback` 表有有效数据、用户认可 Coach 建议并 Apply |
| S-7 | 整个项目生命周期可追溯：每条决策、每条经验、每次 Agent 调整都有记录 | Intelligence Tab 可以回看所有沉淀 |

### 非 MVP 的长期愿景

- 跨 Project 的 Pattern Library（经验迁移）
- 公开的 Workflow / Team Template 市场
- Agent 技能地图 (Skill Matrix) 自动维护

---

## 3. 目标用户与核心场景

### 主目标用户

| 维度 | 描述 |
|------|------|
| 身份 | 独立开发者 / 小团队技术负责人（1-5 人） |
| 技能 | 熟悉命令行与 Cursor / Claude Code / Codex 至少之一 |
| 心智 | 愿意把"运营 AI 员工团队"当作一个**日常能力**来投入，而不是"一次性试用"|
| 痛点 | 现有单 Agent IDE 插件解决不了"多角色协作 + 项目经验沉淀 + 团队持续提升" |

### 非目标用户

- 需要真人协作的团队（不做多用户）
- 完全不用 CLI 的 GUI 用户
- 需要企业级权限 / 审计的组织
- Agent 市场 / 托管平台用户（OpenSpace 是本地工具）

### 核心场景

#### 场景 A：从 Goal 开始，30 秒组建 AI Team

```
用户启动 OpenSpace，点 "+ New Project"：
  Name:      sso-service
  Goal:      Build an OAuth SSO service for internal tools
  Workspace: ~/code/sso-service

系统（Team Architect System Agent 响应）：
  基于你的 Goal，我建议组建以下团队：
  ✓ Architect       - 设计 OAuth 协议和数据模型
  ✓ Dev-Backend     - 用 Node.js 实现 OAuth flow
  ✓ Reviewer        - 审查安全性（token 泄露 / CSRF 等）

  [Approve All] [Customize Team]

用户点 Approve → 3 个 Agent 被创建，自动加入 Project 的 #general channel
30 秒内，用户就有一个可用的 AI 工程团队
```

#### 场景 B：Team 自己设计 Workflow（甬道诞生）

```
团队组建完成后，系统触发 "Workflow Design Session"：

  Facilitator System Agent → "你们打算如何协作交付这个 Goal？"
  Architect → "我建议先出方案，等用户 Approve 后再让 Dev 实现"
  Dev-Backend → "同意。实现后需要 Reviewer 检查安全性"
  Reviewer → "确认。如果我发现问题，打回 Dev 重做"
  
  Facilitator → 综合成 YAML workflow draft：
  
    name: feature-development
    trigger: /new-feature
    steps:
      - design     [Architect executes, user approves]
      - implement  [Dev-Backend executes]
      - review     [Reviewer approves, can reject to implement]
      - done       [close thread]
  
  用户 Approve → Workflow 注册到 Project

这是 OpenSpace 的核心差异化：Workflow 不是用户手写的，也不是模板固定的，
是 Team 自己讨论出来的 —— "甬道" 从协作中诞生。
```

#### 场景 C：执行 + 自动沉淀

```
用户在 #general 输入：/new-feature add Google OAuth

OpenSpace 按 Workflow 驱动：
  Step 1: Architect spawn → 输出方案（thread 内可见）
  Step 2: 用户 Approve → 自动 @Dev-Backend
  Step 3: Dev-Backend spawn → 改代码（cwd = workspace_path）
  Step 4: 自动 @Reviewer → 审查
  Step 5: 完成

Task 结束后，Scribe System Agent 自动回扫整个 thread：
  "此 task 产生的可沉淀条目：
   - [Decision] 采用 PKCE 而非 Implicit Flow，理由：RFC 建议 SPA 使用 PKCE
   - [Lesson] Google OAuth 的 redirect_uri 必须提前在 GCP 注册
   - [Pattern] 安全审查 checklist 新增：token 在 cookie 还是 localStorage"
  
  用户在 Intelligence Tab 的 Pending Queue 看到这些建议 → Approve / Edit → 进入项目知识池
```

#### 场景 D：团队持续成长

```
一周后，Evaluator System Agent 发现：
  - Dev-Backend 3 次忘记在 async 函数 try-catch
  - Architect 的方案被用户 2 次要求补充"错误处理"细节

Coach System Agent 生成建议：
  - Dev-Backend description 增加：
    "始终在 async 函数使用 try-catch，异常要带结构化 error code"
  - Architect description 增加：
    "方案必须包含 error handling strategy 小节"
  
用户在 Agent Profile → FEEDBACK Tab 看到这些建议 → Apply / Reject

Apply 后 agents.description 实际被更新 + 写入 agent_feedback 表（可审计、可回滚）
下次 Agent spawn 时，带着进化过的 description 工作
```

---

## 4. 产品定位（市场坐标）

### 竞品矩阵

| 产品 | 核心定位 | 与 OpenSpace 的差异 |
|------|---------|-----------------|
| **slock.ai** | 云端多用户 AI 员工聊天室 | OpenSpace = 本地 + 单用户 + 可编程运营机制 |
| **Cursor / Claude Code** | 单 Agent IDE 内编程助手 | OpenSpace = 多 Agent 协作 + Goal→Team→Workflow 全自动化 |
| **ClawTeam** | Leader Agent 自主 spawn CLI worker | OpenSpace = 人类作为最终 approver，声明式 Workflow 而非自由调度 |
| **Linear / Shortcut** | 人类工程团队项目管理 | OpenSpace = 面向 AI 团队的项目管理 |
| **LangGraph / AutoGen** | 代码层多 Agent 编排框架 | OpenSpace = 产品层（可用 UI）+ 运营机制（Scribe/Coach/Evaluator）|

### 定位坐标

```
             AI 自主驱动
                 │
           ClawTeam     
                 │      
                 │    **OpenSpace**
                 │   (人 Approve, 
协作聊天 ────────┼───── AI 自驱动) ── 单人 IDE
                 │          
       slock.ai  │  
        (手工)   │    Cursor / Claude Code
                 │
             人类主导
```

OpenSpace 占据 **"AI 自驱动 × 协作编排 × 人类 Approver"** 的独特象限。

### 差异化的四个护城河

1. **Goal → Team AI 配备**：其他产品都要用户手动建 Agent，OpenSpace 从 Goal 推导
2. **Team 协同设计 Workflow**：Workflow 不是手写也不是模板固化，是 AI 团队自己讨论出来的
3. **运营闭环机制**：Scribe/Coach/Evaluator 把 "项目协作" 变成 "团队持续成长"
4. **本地优先 + 完全可审计**：用户始终是最终决策者，Agent 演化可回滚

### 不追求的定位

- ❌ 不做 "最强单 Agent 编程工具"（Cursor 已经足够好）
- ❌ 不做 "云端多人协作"（slock.ai 已经在做）
- ❌ 不做 "Agent 编排 SDK"（LangGraph 是代码框架，OpenSpace 是产品）
- ❌ 不做 "Agent Marketplace"
- ❌ 不做 "AI 陪伴 / 生活助理"（Hermes/OpenClaw 已经做得很好）

---

## 5. 核心概念模型

### 5.1 6 层架构（核心模型）

OpenSpace 的本质是一个 6 层递进的团队运营系统：

```
┌─────────────────────────────────────────────────────┐
│  Layer 6:  Capability      能力强化                  │  ← Evaluator + Coach
│              ↑                                        │
│  Layer 5:  Knowledge       集体知识                  │  ← Scribe + decisions/lessons
│              ↑                                        │
│  Layer 4:  Responsibility  职责框架（Step × Agent）  │  ← RACI 简化
│              ↑                                        │
│  Layer 3:  Workflow        工作流"甬道"              │  ← 声明式 YAML
│              ↑                                        │
│  Layer 2:  Team            团队成员（AI 自动配）     │  ← Team Architect Agent
│              ↑                                        │
│  Layer 1:  Goal            项目目标（一等公民）      │  ← 用户必填、简洁明确
└─────────────────────────────────────────────────────┘
```

**关键特征：每一层都建立在下一层之上，不能跳过**。没有 Goal 无法派生 Team，没有 Team 无法设计 Workflow，没有 Workflow/Team 无法定义 Responsibility。

### 5.2 实体关系图

```
OpenSpace 实例 (一台机器)
 │
 ├── Project  (= 原版 slock.ai 的 Server)
 │    ├── id / name / display_name / workspace_path / goal / team_rules
 │    │
 │    ├── Channels (Project 内话题频道)
 │    │    ├── #dev / #review / #general 等
 │    │    ├── type: 'channel' | 'dm'
 │    │    │
 │    │    ├── channel_agents (多对多)
 │    │    ├── messages (按 channel_id 作用域)
 │    │    └── tasks (按 channel_id 作用域)
 │    │
 │    ├── Agents (Project-scoped，description 可被 Coach 演化)
 │    │
 │    ├── Workflows (声明式 YAML 甬道)
 │    │    └── WorkflowRuns (执行实例，绑定 thread)
 │    │
 │    ├── Responsibilities (Workflow step × Agent)
 │    │
 │    ├── Knowledge
 │    │    ├── Decisions (Scribe 沉淀 / 用户手录)
 │    │    └── Lessons (经验条目，按 audience 过滤注入 prompt)
 │    │
 │    └── Intelligence (项目运营面板)
 │
 └── System Agents (OpenSpace 内置，非 Project-scoped)
      ├── Team Architect  (Goal → Team 推导)
      ├── Facilitator     (主持 Workflow Design Session)
      ├── Scribe          (沉淀 decisions / lessons)
      ├── Evaluator       (评估 Agent 产出)
      ├── Coach           (提出 description 修改建议)
      └── Onboarder       (新 Project 分析 codebase 准备 context)
```

### 5.3 四个运营闭环（Operational Loops）

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenSpace AI Team OS                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐                     │
│  │ Onboarding   │─────▶│  Delivery    │                     │
│  │    Loop      │      │    Loop      │                     │
│  └──────────────┘      └──────────────┘                     │
│         ▲                      │                              │
│         │                      ▼                              │
│  ┌──────────────┐      ┌──────────────┐                     │
│  │    Reuse     │◀─────│  Evolution   │                     │
│  │    Loop      │      │    Loop      │                     │
│  └──────────────┘      └──────────────┘                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

| Loop | 触发 | 核心机制 |
|------|------|---------|
| **Onboarding Loop** | Create Project | Team Architect 从 Goal 推导 Team，Onboarder 分析 codebase 生成初始知识 |
| **Delivery Loop** | Workflow Run 结束 | Scribe 自动回扫 thread 沉淀 decisions / lessons |
| **Evolution Loop** | 每周 / 每 N 个 task | Evaluator 评估 Agent 表现，Coach 提出 description 修改建议 |
| **Reuse Loop** | Agent spawn 前 | ContextBuilder 按 audience 过滤注入 lessons / decisions / 历史决策 |

### 5.4 三者关系：Team × Workflow → Responsibility

```
Workflow  = 步骤集合         (Set of Steps)
Team      = 成员集合         (Set of Agents)
Responsibility = Step × Agent 的连接关系
```

- Workflow 和 Team 是平行独立的实体，各自可以先存在
- Responsibility 必须同时依赖两者，只能在最后定义
- 生成顺序：**Goal → AI 推 Team → Team 协同设计 Workflow → 派生 Responsibility**

---

## 6. 决策清单

### D-1：中心化托管

OpenSpace 采用一次安装、全局使用的中心化形态。单个 OpenSpace 实例（`~/.openspace/openspace.db`）管理所有 Project / Channel / Agent / Workflow / Knowledge。不做 per-project 安装。

### D-2：Server 即 Project

原版 slock.ai Server 在本地语义下即 Project。引入 `projects` 表作为顶层容器：

```sql
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,         -- URL slug
  display_name    TEXT,
  workspace_path  TEXT NOT NULL,                 -- 必填（见 D-8）
  goal            TEXT NOT NULL,                 -- 必填（见 D-3）
  team_rules      TEXT,                          -- Layer 2 团队协作规则（可选）
  color           TEXT,
  created_at      INTEGER NOT NULL
);

-- channels / agents 都归属 Project
ALTER TABLE channels ADD COLUMN project_id TEXT NOT NULL REFERENCES projects(id);
ALTER TABLE agents   ADD COLUMN project_id TEXT NOT NULL REFERENCES projects(id);
```

URL 结构保留原版 Server 语义：`/p/{projectName}/channel/{id}`。

### D-3：Goal 是一等公民（AI 配 Team）

Goal 必须是：
- **具体、明确、可执行**（1-2 句话，最长 500 字符）
- **驱动 Team 自动配备**的依据
- **ContextBuilder 注入 prompt 最顶部**（高于 Agent description 和 team_rules）

**AI 配 Team 流程（Team Architect System Agent）**：

1. 用户填 Goal 后，Team Architect 根据 Goal 推导推荐团队：
   - 输入：Goal + Workspace 基本信息（package.json / README 提示的技术栈）
   - 输出：推荐的 Agent 列表（name / role / description / runtime / model）
2. UI 展示推荐卡片，用户可 Approve All / Customize
3. Approve 后自动实例化 Agents + 加入 `#general` channel

这是用户的**第一个 AHA moment**：从 0 到"有个可用的 AI 团队" ≤ 3 分钟。

**兜底策略（Q-2 + Review 5 决议）**：以下任一情况走固定兜底：
- 未安装 `cursor-agent`
- Team Architect spawn 超时 / 失败
- 返回内容 JSON 解析失败

兜底内容固定为**三件套**：`Architect` + `Dev` + `Reviewer`，**runtime 字段留空等用户配置**（而非写死 cursor），`description` 用通用模板。UI 在 Step 2 展示黄色提示 `"Team Suggestion unavailable, showing default team. Please configure runtime per agent after approval."`。

### D-4：Workflow 即甬道（Team 协同设计）

Workflow 是**声明式 YAML**，每个 Project 可有多个 workflow（每个对应一个 `/command` trigger）：

```yaml
name: feature-development
trigger:
  command: "/new-feature"

steps:
  - id: design
    owner: "@Architect"
    on_complete: await_approval

  - id: await_approval
    owner: "local-user"
    action: approve_or_reject
    on_approve: implement
    on_reject: design

  - id: implement
    owner: "@Dev"
    input: "design"
    on_complete: review

  - id: review
    owner: "@Reviewer"
    on_approve: done
    on_reject: implement

  - id: done
    action: close_thread
```

**Workflow 的两种生成路径**（逻辑上两种都是"Workflow 创建"，不在 schema 里区分）：

| 路径 | 何时用 | 体验 |
|-----|-------|-----|
| **Template Start**（Sprint 2）| 新手 / 常见场景 | 选内置 template（webapp / bug-fix / research），一键生成 |
| **Team-First-Collaborative**（Sprint 7）| 核心差异化 / 进阶 | Facilitator 主持 Session，Team 协商产 YAML，用户 Approve |

**schema 不区分 origin**（用户反馈）—— 最终设计就是最终形态，不保留"兼容多路径"的过渡痕迹。

```sql
CREATE TABLE workflows (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_command TEXT UNIQUE,
  definition_yaml TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE workflow_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id),
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  thread_id       TEXT,                   -- 绑定 thread
  status          TEXT CHECK(status IN ('running','completed','aborted','failed')),
  current_step    TEXT,
  started_by      TEXT,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  state_json      TEXT                    -- 每个 step 的产出 / 状态
);
```

### D-5：Responsibility 即 Step × Agent 连接

Responsibility 是 Workflow 和 Team 的多对多连接表，用简化的 RACI 模型：

```sql
CREATE TABLE responsibilities (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id       TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_id           TEXT NOT NULL,
  agent_id          TEXT REFERENCES agents(id),    -- 可以是 'local-user'
  role              TEXT NOT NULL CHECK(role IN ('executor','approver','reviewer','informed')),
  authority         TEXT CHECK(authority IN ('must_approve','optional_approve','no_authority')),
  created_at        INTEGER NOT NULL
);
```

四种 role：
- **executor**（R）：执行者，做事的
- **approver**（A）：必须批准才能进入下一步（通常是用户或特定 Agent）
- **reviewer**（C）：可以提意见但不阻塞
- **informed**（I）：被通知者，只收消息

**`agent_id = 'local-user'` 是合法值**：用户本人是系统的一等 agent，很多 step 的 approver 就是用户。

### D-6：System Agents 运营团队

OpenSpace 内置 6 个 System Agent，像公司的 HR / QA / PM / Coach：

| Agent | 职责 | 触发时机 | 用户可见度 |
|-------|------|---------|-----------|
| **Team Architect** | Goal → 推导 Team | Create Project 时 | Create Project UI 内 |
| **Facilitator** | 主持 Workflow Design Session | Team 组建完成后 / 手动触发 | Session thread 内 |
| **Scribe** | 沉淀 decisions / lessons | Workflow Run 结束 / thread 解决 | Intelligence Tab Pending Queue |
| **Evaluator** | 评估 Agent 产出质量 | 后台定期 | 异常时上报 |
| **Coach** | 提 Agent description 修改建议 | 每周 / 每 N 个 task | Agent Profile FEEDBACK Tab |
| **Onboarder** | 新 Project 分析 codebase | Create Project + 首次 Agent spawn 前 | Onboarding 面板 |

**实现特征**：
- 和普通 Agent 一样通过 CLI Adapter spawn（复用架构）
- 有 OpenSpace 内置 description（用户不可改）
- 有特殊权限（可写 decisions / lessons / agent_feedback 等表）
- 不出现在频道 Sidebar，不参与 @mention 链
- 在 Intelligence Tab / FEEDBACK Tab 等专属位置可见

### D-7：多 Project 并发隔离契约

**两个同名 Agent（各自归属不同 Project，独立 `agent_id`）** 并发工作时：

> 注：v1.0 已废除跨 Project Agent 复用（N-13）；下文所有 "Agent" 指的都是 project-scoped 的独立实例。同名跨 Project 协作的场景通过"用户在两个 Project 各创建一个同名 Agent"实现。

| 层级 | 隔离 | 机制 |
|-----|------|------|
| 进程层 | 完全 | spawn-per-message |
| Channel 级（对话历史）| 完全 | `WHERE channel_id = ?` |
| Project 级（workspace / Tasks / Threads / Knowledge）| 完全 | 按 `channel.project_id` 路由 |
| Agent 身份（description）| 共享 | 设计如此 |
| CLI 原生记忆（AGENTS.md / CLAUDE.md）| 项目级 | CLI 自管，按 cwd 查找 |

**必须修正的坑**（Sprint 1 范围）：

| # | 问题 | 修正 |
|---|------|------|
| K-1 | `agents.status` 单值全局字段 | 删字段 + 新建 `agent_runs` 表派生 per-channel status |
| K-2 | 链式触发计数维度不明 | 显式按 per-thread 计数 |
| K-3 | `agent_activity` 无 `channel_id` | 加 `channel_id` 字段 + 索引 |
| K-4 | Agent workspace 作为共享 cwd | 改用 `project.workspace_path` |
| K-5 | env_vars 只在 Agent 级 | 新增 `project_agent_overrides` 表（P1，Sprint 2）|

### D-8：聚焦编程协作 + 无 Agent 独立 Workspace

OpenSpace 聚焦"多 Agent 编程协作"，不做：
- 自主学习型 Agent 适配（Hermes / OpenClaw / AutoGPT 等）
- Agent 独立 workspace（`~/.openspace/agents/{id}/` 不存在）
- 跨 Project Agent 复用机制（每个 Project 的 Agent 独立）

**Agent 的"记忆"靠以下机制承载**（无需文件系统）：
- 短期：对话历史通过 ContextBuilder 注入
- 长期：`agents.description` 由 Coach 演化（可审计、可回滚）
- 项目知识：`decisions` / `lessons` 按 audience 注入
- 工程约束：项目内 `AGENTS.md` / `CLAUDE.md`（CLI 原生）

Agent Profile 从原版 3 Tab 简化为 **3 Tab（PROFILE / ACTIVITY / FEEDBACK）**：
- **PROFILE**：身份 + 配置 + 操作（原版一致）
- **ACTIVITY**：运行日志 + Files touched（tool_call 聚合）
- **FEEDBACK**（新）：Coach 建议历史 + Apply/Reject 轨迹

---

## 7. MVP 需求范围

完整需求按 Sprint 组织，详见 §9 Sprint 路线图。此处只列分类：

### P0（必须，分布在 Sprint 1~5）

| 分类 | 需求 | Sprint |
|------|------|--------|
| 基础骨架 | Project / Channel / Goal / Team / workspace 隔离 | Sprint 1 |
| AI 配 Team | Team Architect 从 Goal 推导 Team | Sprint 1 |
| 工作流 | Workflow YAML + 3 内置模板 + 执行引擎 | Sprint 2 |
| 职责 | Responsibilities 表 + 批准流 + 用户介入 | Sprint 3 |
| 沉淀 | Scribe + decisions / lessons + Intelligence Tab | Sprint 4 |
| 成长 | Evaluator + Coach + agent_feedback + Description Evolution | Sprint 5 |

### P1（应该，MVP 后迭代）

| 需求 | Sprint |
|------|--------|
| Onboarder（codebase 自动分析）| Sprint 6 |
| Skill Matrix（Agent 能力地图）| Sprint 6 |
| Team-First-Collaborative Workflow Design | Sprint 7 |
| Workflow YAML Import / Export | Sprint 3+ |
| 跨 Project 经验迁移 | Sprint 7+ |

### P2（可以，远期）

- Codex / Claude Code 多 runtime 适配
- Electron / Tauri 打包
- Agent Template Marketplace

---

## 8. 非目标（明确不做）

| # | 非目标 | 理由 |
|---|--------|------|
| N-1 | 多用户 / 邀请 / 权限 | 本地单用户工具 |
| N-2 | 云端托管 / 多端同步 | 数据本地化是核心卖点 |
| N-3 | 订阅 / 付费 | 免费开源 |
| N-4 | 嵌入到 IDE（VSCode / Cursor 插件）| 独立桌面应用 |
| N-5 | Mobile / 移动端 | 编程场景不适合 |
| N-6 | 企业审计 / 合规日志 | 个人 / 小团队工具 |
| N-7 | 多机器分布式部署 | 单机单实例 |
| N-8 | Agent Fine-tune / 模型训练 | 能力由 CLI 工具决定 |
| N-9 | 自主学习型 Agent 官方适配（Hermes / OpenClaw）| 和聚焦编程协作冲突，§D-8 |
| N-10 | Agent 独立 workspace（`~/.openspace/agents/{id}/`）| 记忆靠 description 演化，§D-8 |
| N-11 | 纯聊天 Project（`workspace_path=NULL`）| 所有 Project 必须绑代码仓库 |
| N-12 | Wiki 式知识库 / 语义搜索 / 向量索引 | OpenSpace 用"团队运营机制"代替静态 Wiki |
| N-13 | 跨 Project Agent 复用 | 每个 Project 独立创建同名 Agent |
| N-14 | `origin` 字段 / 多种 workflow 生成路径的历史兼容字段 | 最终设计即最终形态 |

---

## 9. Sprint 路线图（战略层）

> **本节只列每个 Sprint 的战略价值与交付目标**。当前状态与后续路线见 [`docs/project-plan.html`](project-plan.html)。

按 6 层架构自底向上递进，**每个 Sprint 都有可演示的战略价值**：

| Sprint | 战略意图 | 战略价值 |
|--------|---------|---------|
| **Sprint 1**：Foundation + Goal → AI Team | 3 分钟内从 Goal 得到一个可用的 AI Team | 第一次实现 "Goal → AI 配 Team"，"AI Team OS" 雏形显现，用户**第一分钟**就感受到差异化 |
| **Sprint 2**：Workflow Framework（Template 路径）| 内置 3 个模板，`/new-feature` 等指令驱动整个 thread | 从"聊天室"跃升为"工作流引擎"，Agent 在甬道里有序推进而非自由 @mention |
| **Sprint 3**：Responsibility + User Intervention | 用户可随时介入 / 批准 / 拒绝 / override Workflow | AI 团队**有边界、可控、可审计**，用户成为最终 approver |
| **Sprint 4**：Delivery Loop（Scribe 沉淀）| Workflow Run 结束后自动沉淀 decisions / lessons | OpenSpace 成为**项目知识资产的管理后台**，每次协作产出自动沉淀 |
| **Sprint 5**：Evolution Loop（Agent 成长）| Agent description 随时间由 Coach 演化 | 团队越用越强，达成 S-6（连续使用 3 个月后交付质量可观测提升）|
| **Sprint 6**：Onboarding Loop + Skill Matrix | 新 Project 自动 onboarding；能力地图自动维护 | 锦上添花，让"加入新项目"像翻开一本现成的剧本 |
| **Sprint 7**：Team-First-Collaborative Workflow Design | Facilitator 主持 Team 讨论，自己产出 Workflow YAML | **核心差异化**：Workflow 不是用户写的也不是模板固化的，是 Team 自己讨论出来的 |
| **Sprint 8+**：远期迭代 | 跨 Project 经验迁移 / Workflow 自演化 / Marketplace / 多 runtime / Worktree 隔离 / B-N 借鉴条目 | 护城河持续加固 |

> Sprint 4 / Sprint 7 的拆分背景：v1.0 v0.3 初稿把 Scribe + Facilitator 捆在一个 Sprint，工期严重低估。Review 3 决议拆分成 Sprint 4（Scribe）+ Sprint 7（Facilitator）。

---

## 10. 待决议事项

Sprint 1 启动前需要拍板的议题。其他议题在对应 Sprint 前决定。

> **Sprint 启动前规则**：每个 Sprint 启动前，负责人必须扫一遍本表，把 `Deadline <= 本 Sprint` 的 `Q-N` 全部拍板或显式延期，否则该 Sprint 不能动工。

### 已决议（Sprint 1 范围）

| # | 议题 | 决议 | 决议日期 |
|---|------|------|---------|
| Q-1 ✅ | Team Architect 推导 Team 用哪个 runtime? | **Cursor Agent**（和业务 Agent 一致，复用 CLIAdapter 架构）| 2026-04-23 |
| Q-2 ✅ | 没装 cursor-agent 的用户如何 seed first Agent? | **欢迎页引导安装 CLI，不强制**（无 CLI 时 Create Project 流程在 Team Suggestion 步骤友好降级）| 2026-04-23 |
| Q-3 ✅ | `projects.goal` 的长度上限? | **500 字符**（鼓励简洁，超出截断 + UI 提示）| 2026-04-23 |

### 待决议

| # | 议题 | 建议默认 | Deadline |
|---|------|---------|---------|
| Q-4 | Workflow YAML 的版本控制? | 存 SQL + 提供 Export，不做 SQL 内 version 字段 | Sprint 2 启动前 |
| Q-5 | System Agent 的 token 消耗是否计入 Agent 配额? | 独立配额（每月 $X 给系统 Agent）| Sprint 4 启动前 |
| Q-6 | Coach 建议 Apply 后能否回滚? | 能，`agent_feedback` 保留完整 diff 历史 | Sprint 5 启动前 |
| Q-7 | Scribe 沉淀的 lessons 是否默认 public 到其他 Project? | 默认 Project-private，Sprint 8+ 再讨论迁移 | Sprint 4 启动前 |
| Q-8 | Facilitator Session 的触发是自动（Team 组建完成后）还是手动? | **Sprint 7** 先手动触发，用户有掌控感 | **Sprint 7** 启动前 |

---

## 11. 版本历史

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1 | 2026-04-22 | 首版：Channel 即 Project 简化模型 | - |
| v0.2 | 2026-04-23 | 校准：Server = Project；引入 projects 表 | - |
| v0.3 草案 | 2026-04-23 | 聚焦编程协作 / 砍自主学习型 Agent / 无 Agent workspace | - |
| **v1.0** | 2026-04-23 | **产品定位跃升**：Programmable AI Team OS；6 层架构；4 Loop；6 System Agents；Sprint 1~6 路线图；schema 不保留历史兼容字段 | - |
| v1.0.1 | 2026-04-23 | v1.0 Review 决议落地：S-1 起止点明确为 Welcome → Send；S-2 / D-7 改表述为"同名 Agent 各归属不同 Project"；D-3 补兜底三件套逻辑；§9 拆分 Sprint 4（Scribe 单独，Facilitator 延后到 Sprint 7）；§10 加 Sprint 启动前扫描规则 | - |
| **v1.1** | 2026-04-30 | **文档体系简化**：§9 Sprint 路线图压缩为单表；删除 §11 实现指引（迁移已完成 / technical-decisions.md / ui-reference 已落地） | - |

---

**本文档的角色**：产品层的北极星。任何新需求 / 新功能先问"是否符合 §1 定位和 §8 非目标"；冲突时要么拒绝，要么先修订本文档。
