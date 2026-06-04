/**
 * Settings 页（路径 `/settings`，Sprint 4-ext / S-1 收尾）
 *
 * 当前包含一个卡片：Cursor Backend
 *   - Backend 选择：CLI（cursor-agent 子进程）/ SDK（@cursor/sdk 直连）
 *   - API key 输入（SDK 模式必需）
 *   - Save 按钮 → POST /api/settings/cursor，写入 ~/.openspace/settings.json，
 *     运行时立即生效（下次 spawn agent 用新 backend）
 *   - 状态展示：Cursor.me() 验证用户身份、ripgrep 路径（SDK 模式）
 */

import { useEffect, useState } from 'react';
import type { CursorBackend, CursorBackendStatus } from '@openspace/shared';
import {
  changePassword,
  createUser,
  disableUser,
  enableUser,
  getCursorSettings,
  listAdminUsers,
  resetUserPassword,
  updateCursorSettings,
  type AuthUser,
} from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useUsersStore } from '../stores/users';

export function SettingsPage() {
  const [status, setStatus] = useState<CursorBackendStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  // 表单 state
  const [backend, setBackend] = useState<CursorBackend>('cli');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [errorFlash, setErrorFlash] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // 初次加载
  useEffect(() => {
    void loadStatus(true);
  }, []);

  async function loadStatus(validate: boolean) {
    if (validate) setRefreshing(true);
    try {
      const s = await getCursorSettings(validate);
      setStatus(s);
      setBackend(s.backend);
      // 不回填 apiKey（避免显示已有 key，UX 上也无意义 —— 用户重新输入才提交）
    } catch (e) {
      setErrorFlash(`加载失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSavedFlash(null);
    setErrorFlash(null);
    try {
      const payload: Parameters<typeof updateCursorSettings>[0] = {
        backend,
        validate: true,
      };
      const trimmed = apiKey.trim();
      if (trimmed) payload.apiKey = trimmed;
      const next = await updateCursorSettings(payload);
      setStatus(next);
      setApiKey('');
      if (next.identityError) {
        setErrorFlash(`保存成功，但 API key 验证失败：${next.identityError}`);
      } else if (next.identity) {
        setSavedFlash(`已保存。验证通过：${next.identity.apiKeyName}`);
      } else {
        setSavedFlash('已保存。');
      }
    } catch (e) {
      setErrorFlash(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleClearKey() {
    if (!confirm('确认清除已保存的 API key？SDK 模式下 agent 将无法工作直到重新配置。')) return;
    setSaving(true);
    setSavedFlash(null);
    setErrorFlash(null);
    try {
      const next = await updateCursorSettings({ apiKey: null, validate: false });
      setStatus(next);
      setApiKey('');
      setSavedFlash('API key 已清除。');
    } catch (e) {
      setErrorFlash(`清除失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    setChangingPassword(true);
    setSavedFlash(null);
    setErrorFlash(null);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setSavedFlash('Password updated.');
    } catch (e) {
      setErrorFlash(`Password update failed: ${(e as Error).message}`);
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">Settings</h1>
          <button
            type="button"
            onClick={() => void loadStatus(true)}
            disabled={refreshing}
            className="text-xs font-mono text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>

        <section className="bg-bg-card border-2 border-black rounded-xl p-6 shadow-[6px_6px_0_0_#000]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold">Account</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Signed in as <span className="font-mono font-bold">{user?.username}</span>
                {user?.role ? ` (${user.role})` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded border-2 border-black bg-white px-3 py-2 text-xs font-bold hover:bg-accent-yellow"
            >
              Sign out
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-bold uppercase">Current password</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1 w-full rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase">New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void handleChangePassword()}
            disabled={changingPassword || !currentPassword || !newPassword}
            className="mt-4 rounded border-2 border-black bg-accent-green px-4 py-2 text-sm font-bold shadow-[3px_3px_0_0_#000] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {changingPassword ? 'Updating…' : 'Change password'}
          </button>
        </section>

        {user?.role === 'admin' && <AdminUsersPanel />}

        {/* Cursor Backend 卡片 */}
        <section className="bg-bg-card border-2 border-black rounded-xl p-6 shadow-[6px_6px_0_0_#000]">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-lg font-bold">Cursor Backend</h2>
            <span className="text-[11px] font-mono text-text-muted">
              ~/.openspace/settings.json
            </span>
          </div>
          <p className="text-sm text-text-secondary mb-5">
            选择 OpenSpace 调用 Cursor 的方式：spawn 子进程（CLI）或直连 API（SDK）。SDK
            模式启动更快、tool_call schema 更稳定，但需要 API key。
          </p>

          {/* Backend selector */}
          <div className="space-y-2 mb-5">
            <BackendOption
              value="cli"
              checked={backend === 'cli'}
              onChange={() => setBackend('cli')}
              title="CLI"
              subtitle="spawn cursor-agent 子进程（默认，需要本机已安装 cursor-agent 并登录）"
            />
            <BackendOption
              value="sdk"
              checked={backend === 'sdk'}
              onChange={() => setBackend('sdk')}
              title="SDK"
              subtitle={
                <>
                  使用 <code className="font-mono">@cursor/sdk</code> 直连 Cursor 后端，需要
                  User API key（
                  <a
                    href="https://cursor.com/dashboard/integrations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium hover:text-accent-pink"
                  >
                    cursor.com/dashboard/integrations
                  </a>
                  ）
                </>
              }
            />
          </div>

          {/* API key 输入 */}
          <div className="space-y-3 mb-5">
            <label className="block">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-bold">Cursor API Key</span>
                {status?.hasApiKey && (
                  <span className="text-[11px] font-mono text-text-secondary">
                    已配置（来源：{status.apiKeySource ?? '?'}）
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    status?.hasApiKey
                      ? '已保存（留空 = 不修改；输入新值 = 覆盖）'
                      : 'crsr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
                  }
                  className="flex-1 px-3 py-2 border-2 border-black rounded font-mono text-sm bg-bg-main focus:outline-none focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="px-3 py-2 border-2 border-black rounded text-sm hover:bg-accent-yellow"
                  title={showKey ? '隐藏' : '显示'}
                >
                  {showKey ? '◌' : '●'}
                </button>
              </div>
              <p className="text-[11px] text-text-muted mt-1.5">
                OpenSpace 不是多租户应用，key 仅写入本地{' '}
                <code className="font-mono">~/.openspace/settings.json</code>，不入版本库。
              </p>
            </label>

            {status?.hasApiKey && (
              <button
                type="button"
                onClick={() => void handleClearKey()}
                disabled={saving}
                className="text-xs font-mono text-red-700 hover:underline disabled:opacity-50"
              >
                清除已保存的 API key
              </button>
            )}
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3 mb-5">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-5 py-2 border-2 border-black rounded bg-accent-pink font-bold hover:brightness-105 shadow-[3px_3px_0_0_#000] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save & Verify'}
            </button>
            {savedFlash && (
              <span className="text-sm text-green-700 font-medium">✓ {savedFlash}</span>
            )}
            {errorFlash && (
              <span className="text-sm text-red-700 font-medium">✗ {errorFlash}</span>
            )}
          </div>

          {/* 当前状态 */}
          {status && <StatusPanel status={status} />}
        </section>

        <p className="text-xs text-text-muted text-center font-mono">
          OpenSpace v1.0 · settings persist to{' '}
          <code className="font-mono">~/.openspace/settings.json</code>
        </p>
      </div>
    </div>
  );
}

function BackendOption({
  value,
  checked,
  onChange,
  title,
  subtitle,
}: {
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  subtitle: React.ReactNode;
}) {
  return (
    <label
      className={`block border-2 border-black rounded p-3 cursor-pointer transition ${
        checked ? 'bg-accent-yellow' : 'bg-bg-main hover:bg-accent-yellow/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="cursor-backend"
          value={value}
          checked={checked}
          onChange={onChange}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">{title}</div>
          <div className="text-xs text-text-secondary mt-0.5 leading-relaxed">{subtitle}</div>
        </div>
      </div>
    </label>
  );
}

function AdminUsersPanel() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshDirectory = useUsersStore((s) => s.refresh);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listAdminUsers());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    setBusy('create');
    setError(null);
    try {
      const user = await createUser({ username, displayName, password });
      setUsers((rows) => [...rows, user]);
      setUsername('');
      setDisplayName('');
      setPassword('');
      await refreshDirectory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(user: AuthUser) {
    setBusy(user.id);
    setError(null);
    try {
      const next = user.disabled_at ? await enableUser(user.id) : await disableUser(user.id);
      setUsers((rows) => rows.map((row) => (row.id === next.id ? next : row)));
      await refreshDirectory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(user: AuthUser) {
    const nextPassword = window.prompt(`New password for ${user.username}`);
    if (!nextPassword) return;
    setBusy(user.id);
    setError(null);
    try {
      await resetUserPassword(user.id, nextPassword);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-bg-card border-2 border-black rounded-xl p-6 shadow-[6px_6px_0_0_#000]">
      <div className="mb-4">
        <h2 className="text-lg font-bold">Users</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Create accounts for teammates. Registration is disabled.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          className="rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
        />
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="display name"
          className="rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="initial password"
          className="rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy !== null || !username || !password}
          className="rounded border-2 border-black bg-accent-green px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
        >
          Create
        </button>
      </div>

      {error && <div className="mt-3 font-mono text-xs text-accent-red">{error}</div>}

      <div className="mt-5 divide-y-2 divide-black/10 border-2 border-black bg-bg-main">
        {loading ? (
          <div className="p-3 font-mono text-xs text-text-secondary">Loading users...</div>
        ) : (
          users.map((row) => (
            <div key={row.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{row.display_name ?? row.username}</span>
                  <span className="font-mono text-xs text-text-secondary">@{row.username}</span>
                  <span className="rounded border border-black px-1.5 py-0.5 font-mono text-[10px]">
                    {row.role}
                  </span>
                  {row.disabled_at && (
                    <span className="rounded border border-black bg-accent-red px-1.5 py-0.5 font-mono text-[10px]">
                      disabled
                    </span>
                  )}
                </div>
                {row.last_login_at && (
                  <div className="mt-1 font-mono text-[11px] text-text-secondary">
                    last login {new Date(row.last_login_at).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void resetPassword(row)}
                  className="rounded border-2 border-black bg-white px-2 py-1 text-xs font-bold hover:bg-accent-yellow disabled:opacity-60"
                >
                  Reset password
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void toggle(row)}
                  className="rounded border-2 border-black bg-white px-2 py-1 text-xs font-bold hover:bg-accent-yellow disabled:opacity-60"
                >
                  {row.disabled_at ? 'Enable' : 'Disable'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function StatusPanel({ status }: { status: CursorBackendStatus }) {
  return (
    <div className="border-t-2 border-black pt-4 space-y-2 text-sm">
      <div className="font-bold mb-1">Current Status</div>
      <Row label="Backend">
        <span className="font-mono">{status.backend}</span>
      </Row>
      <Row label="API key">
        {status.hasApiKey ? (
          <span className="font-mono">已配置（{status.apiKeySource ?? '?'}）</span>
        ) : (
          <span className="font-mono text-red-700">未配置</span>
        )}
      </Row>
      {status.identity && (
        <Row label="Verified as">
          <span className="font-mono">{status.identity.apiKeyName}</span>
        </Row>
      )}
      {status.identityError && (
        <Row label="Verify error">
          <span className="font-mono text-red-700">{status.identityError}</span>
        </Row>
      )}
      {status.ripgrep && (
        <Row label="Ripgrep">
          {status.ripgrep.configured ? (
            <span className="font-mono text-[11px] truncate" title={status.ripgrep.path}>
              ✓ {shortenPath(status.ripgrep.path)}
            </span>
          ) : (
            <span className="font-mono text-yellow-700">未自动定位</span>
          )}
        </Row>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="w-28 flex-shrink-0 text-text-secondary text-xs">{label}</div>
      <div className="flex-1 min-w-0 truncate">{children}</div>
    </div>
  );
}

function shortenPath(p?: string): string {
  if (!p) return '';
  return p.replace(/^.*\/node_modules\//, 'node_modules/');
}
