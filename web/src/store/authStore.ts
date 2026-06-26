import { create } from 'zustand';
import { authApi } from '../api/auth';
import type { User } from '../types/api';

interface AuthState {
  user: User | null;
  status: 'loading' | 'authed' | 'guest';
  hydrate: () => Promise<void>;
  login: (identity: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  hydrate: async () => {
    try {
      const u = await authApi.me();
      set({ user: u, status: 'authed' });
    } catch {
      set({ user: null, status: 'guest' });
    }
  },
  login: async (identity, password) => {
    const u = await authApi.login(identity, password);
    set({ user: u, status: 'authed' });
  },
  logout: async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    set({ user: null, status: 'guest' });
  },
}));