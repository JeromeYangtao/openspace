# Routes Specification

> URL 结构与页面状态映射。依据 slock.ai 实地路由记录。

## Server 前缀

原版：`https://app.slock.ai/s/{serverName}/...`

本地版：由于单服务器，可改为 `/` 直接挂载，或保持 `/s/local/` 前缀便于复用。

## 主路由表

| URL | 页面 | 主内容区 | 可同时显示 |
|------|------|---------|------------|
| `/` | Server 首页 | 默认频道或欢迎页 | Sidebar |
| `/channel/{id}` | 频道聊天 | Chat 视图 | Sidebar |
| `/channel/{id}?chatTab=tasks` | 频道 Tasks | Tasks 面板（Tab 形式） | Sidebar |
| `/dm/{id}` | Agent DM | Chat 视图 | Sidebar |
| `/dm/{id}?chatTab=tasks` | DM Tasks | Tasks 面板 | Sidebar |
| `/threads` | 全局 Threads | Thread 列表 | Sidebar |
| `/tasks` | **全局 Tasks 看板** | Kanban Board 或 List | Sidebar |
| `/saved` | 全局 Saved | 收藏消息列表 | Sidebar |
| `/machine/{id}` | Machine 详情 | Machine info + Agents 列表 | Sidebar |
| `/agent/{id}` | Agent 独立页（少用） | 完整 Profile | Sidebar |
| `/settings` | Account 设置 | Account 设置 | Sidebar |
| `/settings/server` | Server 设置 | Server 设置 | Sidebar |

## Query 参数（叠加状态）

这些 query 参数可在任意 channel/dm 路由上叠加，控制右侧第 3 栏显示什么：

| 参数 | 值 | 作用 |
|------|-----|------|
| `sidebarTab` | `chat` / `members` | Sidebar 当前 Tab（Chat Tab / Members Tab） |
| `chatTab` | `chat` / `tasks` | 主内容 Tab |
| `profile` | `agent:{agentId}` | 右侧打开 Agent Profile 面板 |
| `agentTab` | `profile` / `workspace` / `activity` | Profile 内当前 Tab |
| `thread` | `{channelId}:{messageId}` | 右侧打开 Thread 面板（基于消息 id） |

## URL 示例

```
# 打开 #all 频道
/channel/d3379ad2-2464-41ef-999b-357e918fb9e4

# 切到 Tasks 视图
/channel/d3379ad2-2464-41ef-999b-357e918fb9e4?chatTab=tasks

# 查看 Architect DM
/dm/cbfabd2a-070c-4f4d-aa11-1e1a33b5d88b

# DM + 右侧打开 Architect Profile
/dm/cbfabd2a-...?profile=agent:5b406b46-ce79-4a83-87cd-dc7dd335ee62

# DM + Profile + 切到 Workspace Tab
/dm/cbfabd2a-...?profile=agent:5b406b46-...&agentTab=workspace

# DM + 右侧打开某 Thread
/dm/cbfabd2a-...?thread=cbfabd2a-...:f7bc23d6-9dca-4064-8335-f8800e4e391e

# 切到 Members Sidebar Tab
/?sidebarTab=members
# 或
/channel/...?sidebarTab=members
```

## 路由互斥规则

- `profile` 和 `thread` **互斥**：右侧第 3 栏同时只能显示 Profile 或 Thread
- `agentTab` 仅在 `profile` 存在时有效
- `chatTab=tasks` 和 `profile/thread` 可并存

## 前端实现建议（React Router）

```typescript
// 路由结构
<Routes>
  <Route path="/" element={<Layout />}>
    <Route index element={<WelcomePage />} />
    <Route path="channel/:channelId" element={<ChannelPage />} />
    <Route path="dm/:dmId" element={<DMPage />} />
    <Route path="threads" element={<GlobalThreadsPage />} />
    <Route path="tasks" element={<GlobalTasksPage />} />
    <Route path="saved" element={<SavedPage />} />
    <Route path="agent/:agentId" element={<AgentStandalonePage />} />
    <Route path="settings/*" element={<SettingsPage />} />
  </Route>
</Routes>

// 右侧面板状态通过 useSearchParams 读取
const [params] = useSearchParams();
const profileId = params.get('profile'); // "agent:uuid"
const threadKey = params.get('thread'); // "channelId:messageId"
const sidebarTab = params.get('sidebarTab') ?? 'chat';
const chatTab = params.get('chatTab') ?? 'chat';
const agentTab = params.get('agentTab') ?? 'profile';
```

## MVP 路由范围

**MVP 必须支持**：
- `/channel/{id}` + `?chatTab=tasks`
- `/dm/{id}` + `?chatTab=tasks`
- `?sidebarTab=members`
- `?profile=agent:{id}` + `?agentTab=profile|workspace|activity`
- `?thread={channelId}:{messageId}`

**MVP 后续**：
- `/threads`、`/tasks`（全局看板）、`/saved`
- `/machine/{id}`（本地版只有本机，可合并到 Settings）
- `/settings/*`
