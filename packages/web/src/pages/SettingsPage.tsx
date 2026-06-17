import { useEffect, useState } from 'react';
import {
  changePassword,
  createUser,
  disableUser,
  enableUser,
  listAdminUsers,
  resetUserPassword,
  type AuthUser,
} from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useUsersStore } from '../stores/users';

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const refreshDirectory = useUsersStore((s) => s.refresh);

  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [errorFlash, setErrorFlash] = useState<string | null>(null);
  const [profileUsername, setProfileUsername] = useState(user?.username ?? '');
  const [profileDisplayName, setProfileDisplayName] = useState(user?.display_name ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    setProfileUsername(user?.username ?? '');
    setProfileDisplayName(user?.display_name ?? '');
  }, [user?.username, user?.display_name]);

  const profileChanged =
    profileUsername.trim().toLowerCase() !== (user?.username ?? '') ||
    profileDisplayName.trim() !== (user?.display_name ?? '');

  async function handleSaveProfile() {
    setSavingProfile(true);
    setSavedFlash(null);
    setErrorFlash(null);
    try {
      await updateProfile({
        username: profileUsername,
        displayName: profileDisplayName,
      });
      await refreshDirectory();
      setSavedFlash('Profile updated.');
    } catch (e) {
      setErrorFlash(`Profile update failed: ${(e as Error).message}`);
    } finally {
      setSavingProfile(false);
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

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">Settings</h1>
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
              <span className="text-xs font-bold uppercase">Username</span>
              <input
                value={profileUsername}
                onChange={(e) => setProfileUsername(e.target.value)}
                autoComplete="username"
                className="mt-1 w-full rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
              />
              <span className="mt-1 block text-[11px] font-mono text-text-secondary">
                3-40 chars: lowercase letters, numbers, dot, underscore, dash.
              </span>
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase">Display name</span>
              <input
                value={profileDisplayName}
                onChange={(e) => setProfileDisplayName(e.target.value)}
                className="mt-1 w-full rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void handleSaveProfile()}
            disabled={savingProfile || !profileUsername.trim() || !profileChanged}
            className="mt-4 rounded border-2 border-black bg-accent-green px-4 py-2 text-sm font-bold shadow-[3px_3px_0_0_#000] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingProfile ? 'Saving...' : 'Save profile'}
          </button>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
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
          {savedFlash && (
            <div className="mt-3 text-sm font-medium text-green-700">{savedFlash}</div>
          )}
          {errorFlash && (
            <div className="mt-3 text-sm font-medium text-red-700">{errorFlash}</div>
          )}
        </section>

        {user?.role === 'admin' && <AdminUsersPanel />}
      </div>
    </div>
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
