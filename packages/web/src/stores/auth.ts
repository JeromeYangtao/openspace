import { create } from 'zustand';
import {
  bootstrapAdmin,
  getBootstrapStatus,
  getCurrentUser,
  login,
  logout,
  type AuthUser,
} from '../lib/api';
import { wsClient } from '../lib/ws';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  bootstrapRequired: boolean;
  refresh: () => Promise<void>;
  bootstrap: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  bootstrapRequired: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const { user } = await getCurrentUser();
      set({ user, bootstrapRequired: false, loading: false });
    } catch {
      const status = await getBootstrapStatus().catch(() => ({ required: false }));
      set({ user: null, bootstrapRequired: status.required, loading: false });
    }
  },

  bootstrap: async (username, password) => {
    const { user } = await bootstrapAdmin({ username, password });
    set({ user, bootstrapRequired: false });
  },

  login: async (username, password) => {
    const { user } = await login({ username, password });
    set({ user, bootstrapRequired: false });
  },

  logout: async () => {
    await logout();
    wsClient.close();
    set({ user: null, bootstrapRequired: false });
  },
}));
