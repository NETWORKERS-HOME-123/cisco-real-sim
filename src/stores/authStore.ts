import { create } from 'zustand';
import * as api from '../lib/api/client';
import type { User } from '../lib/api/types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  error: null,

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = await api.login(username, password);
      set({ user, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  register: async (username: string, password: string, displayName?: string) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = await api.register(username, password, displayName);
      set({ user, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  logout: () => {
    api.logout();
    set({ user: null });
  },

  checkAuth: async () => {
    if (!api.isLoggedIn()) return;
    set({ isLoading: true });
    try {
      const user = await api.getMe();
      set({ user, isLoading: false });
    } catch {
      api.logout();
      set({ user: null, isLoading: false });
    }
  },
}));
