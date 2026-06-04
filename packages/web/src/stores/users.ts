import { create } from 'zustand';
import { listUsers, type AuthUser } from '../lib/api';

interface UsersState {
  users: AuthUser[];
  usersById: Map<string, AuthUser>;
  loaded: boolean;
  refresh: () => Promise<void>;
  upsert: (user: AuthUser) => void;
}

export const useUsersStore = create<UsersState>((set) => ({
  users: [],
  usersById: new Map(),
  loaded: false,

  refresh: async () => {
    const users = await listUsers();
    set({
      users,
      usersById: new Map(users.map((user) => [user.id, user])),
      loaded: true,
    });
  },

  upsert: (user) =>
    set((s) => {
      const users = [...s.users];
      const idx = users.findIndex((row) => row.id === user.id);
      if (idx >= 0) users[idx] = user;
      else users.push(user);
      return {
        users,
        usersById: new Map(users.map((row) => [row.id, row])),
      };
    }),
}));
