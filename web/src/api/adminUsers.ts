// API client for the admin "API 使用管理" module.
// Mirrors the 13 backend endpoints at /api/admin-users/*.

import { api } from './client';
import type { UserGroup } from '../types/api';

export interface AdminUserSummary {
  UserId: number;
  Name?: string;
  Username?: string;
  Email?: string;
  Active: boolean;
  HasApiKey: boolean;
  ApiKeyActive: boolean;
  UserAccessFlags: number;
  IsAllowAll: boolean;
  UserGroupIds: number[];
  _unresolved?: boolean;
}

export interface AdminUserDetail extends AdminUserSummary {
  CustomerTag?: string;
  Language?: string;
  TwoFactorAuthenticationEnabled?: boolean;
  FlagBreakdown?: string[];
  _fromCache?: boolean;
}

export interface DirectorySources {
  fromGroups: number;
  fromSeed: number;
  fromManual: number;
}

export interface AuditEvent {
  id: string;
  userId: number;
  action: string;
  actor: string;
  detail?: string;
  ts: number;
}

export interface UsageRow {
  userId: number;
  calls: number;
  errors: number;
  errorRate: number;
  lastActiveAt: number;
}

export interface UsageSummary {
  rows: UsageRow[];
  totals: { calls: number; errors: number; errorRate: number };
}

export const adminUsersApi = {
  // GET /directory?seedIds=…
  list: (params?: { seedIds?: string }) => {
    const q = params?.seedIds ? `?seedIds=${encodeURIComponent(params.seedIds)}` : '';
    return api.get<{ users: AdminUserSummary[]; sources: DirectorySources }>(
      `/admin-users/directory${q}`,
    );
  },

  // GET /users/:id
  get: (id: number) => api.get<AdminUserDetail>(`/admin-users/users/${id}`),

  // GET /user-groups
  getUserGroups: () =>
    api.get<{ groups: UserGroup[] }>(`/admin-users/user-groups`),

  // POST /users/:id/api-key
  createApiKey: (id: number) =>
    api.post<{ apiKey: string }>(`/admin-users/users/${id}/api-key`),

  // DELETE /users/:id/api-key
  revokeApiKey: (id: number) =>
    api.del<{ ok: boolean }>(`/admin-users/users/${id}/api-key`),

  // PUT /users/:id/permissions
  updatePermissions: (id: number, userAccessFlags: number) =>
    api.put<{ user: AdminUserDetail }>(`/admin-users/users/${id}/permissions`, {
      userAccessFlags,
    }),

  // PUT /users/:id/lifecycle
  updateLifecycle: (
    id: number,
    body: { active?: boolean; userGroupIds?: number[] },
  ) => api.put<{ user: AdminUserDetail }>(`/admin-users/users/${id}/lifecycle`, body),

  // POST /users
  createUser: (body: {
    username: string;
    name?: string;
    email?: string;
    password: string;
    userGroupIds?: number[];
  }) => api.post<{ userId: number; user: AdminUserDetail }>(`/admin-users/users`, body),

  // POST /users/:id/reset-password (501 stub on backend)
  resetPassword: (id: number, newPassword: string) =>
    api.post<{ ok: boolean }>(`/admin-users/users/${id}/reset-password`, { newPassword }),

  // GET /usage/summary?userId=
  usageSummary: (userId?: number) => {
    const q = userId ? `?userId=${userId}` : '';
    return api.get<UsageSummary>(`/admin-users/usage/summary${q}`);
  },

  // POST /usage/log
  logUsage: (body: {
    userId: number;
    endpoint: string;
    statusCode: number;
    latencyMs: number;
  }) => api.post<{ ok: boolean }>(`/admin-users/usage/log`, body),

  // GET /audit?userId=&limit=
  audit: (userId?: number, limit = 50) => {
    const parts: string[] = [];
    if (userId) parts.push(`userId=${userId}`);
    parts.push(`limit=${limit}`);
    return api.get<{ events: AuditEvent[]; degraded: boolean; reason?: string }>(
      `/admin-users/audit?${parts.join('&')}`,
    );
  },

  // GET /default-incident-template — admin override for AI-chat escalation.
  // Returns { templateId: number | null }.
  getDefaultIncidentTemplate: () =>
    api.get<{ templateId: number | null }>(`/admin-users/default-incident-template`),

  // POST /default-incident-template — set admin override. Pass null to clear.
  setDefaultIncidentTemplate: (templateId: number | null) =>
    api.post<{ templateId: number | null }>(
      `/admin-users/default-incident-template`,
      { templateId },
    ),

  // --- API usage analytics (admin-only) -----------------------------------

  // GET /api-usage/recent?userId?&limit?&sinceMs?
  getApiUsageRecent: (params?: { userId?: number; limit?: number; sinceMs?: number }) => {
    const parts: string[] = [];
    if (params?.userId !== undefined) parts.push(`userId=${params.userId}`);
    if (params?.limit !== undefined) parts.push(`limit=${params.limit}`);
    if (params?.sinceMs !== undefined) parts.push(`sinceMs=${params.sinceMs}`);
    const q = parts.length ? `?${parts.join('&')}` : '';
    return api.get<ApiUsageRecentResponse>(`/admin-users/api-usage/recent${q}`);
  },

  // GET /api-usage/by-endpoint?userId?&sinceMs?
  getApiUsageByEndpoint: (params?: { userId?: number; sinceMs?: number }) => {
    const parts: string[] = [];
    if (params?.userId !== undefined) parts.push(`userId=${params.userId}`);
    if (params?.sinceMs !== undefined) parts.push(`sinceMs=${params.sinceMs}`);
    const q = parts.length ? `?${parts.join('&')}` : '';
    return api.get<ApiUsageByEndpointResponse>(`/admin-users/api-usage/by-endpoint${q}`);
  },
};
// --- API usage analytics (admin-only) -------------------------------------

export type ApiAuthMode = 'accessToken' | 'apiKey' | 'both' | 'none';

export interface ApiRequestLogEntry {
  ts: number;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  callerIdentity: string;
  callerUserId: number;
  authMode: ApiAuthMode;
  attemptedRetries: number;
}

export interface ApiUsageRecentResponse {
  entries: ApiRequestLogEntry[];
  total: number;
  degraded: boolean;
  reason: string;
}

export interface EndpointSummary {
  method: string;
  path: string;
  calls: number;
  errors: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastCalledAt: number;
}

export interface IdentitySummary {
  callerIdentity: string;
  callerUserId: number;
  calls: number;
  errors: number;
  errorRate: number;
  lastCalledAt: number;
}

export interface GlobalSummary {
  totalCalls: number;
  totalErrors: number;
  errorRate: number;
  uniqueEndpoints: number;
  uniqueIdentities: number;
  windowMs: number;
}

export interface ApiUsageByEndpointResponse {
  rows: EndpointSummary[];
  global: GlobalSummary;
  byIdentity: IdentitySummary[];
  windowMs: number;
}
