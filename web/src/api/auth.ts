import { api } from './client';
import type { User } from '../types/api';

export const authApi = {
  login: (identity: string, password: string) =>
    api.post<User>('/auth/login', { identity, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get<User>('/auth/me'),
  demoHint: () => api.get<{ identity: string; hasPassword: boolean }>('/auth/demo-hint'),
};