import { useState } from 'react';
import { useAuthStore } from '../stores/auth';

interface AuthPageProps {
  mode: 'bootstrap' | 'login';
}

export function AuthPage({ mode }: AuthPageProps) {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBootstrap = mode === 'bootstrap';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nextUsername = username.trim().toLowerCase();
    if (!nextUsername || !password) {
      setError('Username and password are required.');
      return;
    }
    if (isBootstrap && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      if (isBootstrap) {
        await bootstrap(nextUsername, password);
      } else {
        await login(nextUsername, password);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-main px-4 py-8 text-text-primary">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-sm flex-col justify-center">
        <div className="mb-6">
          <div className="font-mono text-xs font-bold uppercase text-accent-pink">OpenSpace</div>
          <h1 className="mt-2 text-2xl font-bold">
            {isBootstrap ? 'Create admin user' : 'Sign in'}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            {isBootstrap
              ? 'Create the first administrator account for this server.'
              : 'Use your OpenSpace account to continue.'}
          </p>
        </div>

        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-4 rounded border-2 border-black bg-bg-card p-5 shadow-[6px_6px_0_0_#000]"
        >
          <label className="block">
            <span className="text-xs font-bold uppercase">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isBootstrap ? 'new-password' : 'current-password'}
              className="mt-1 w-full rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
            />
          </label>

          {isBootstrap && (
            <label className="block">
              <span className="text-xs font-bold uppercase">Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded border-2 border-black bg-bg-main px-3 py-2 font-mono text-sm focus:bg-white focus:outline-none"
              />
            </label>
          )}

          {error && <div className="font-mono text-xs text-accent-red">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded border-2 border-black bg-accent-pink px-4 py-2 text-sm font-bold shadow-[3px_3px_0_0_#000] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Working...' : isBootstrap ? 'Create admin' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
