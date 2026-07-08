import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { requireSession } from '../session/middleware.js';
import { requireAdmin } from '../middleware/admin.js';
import { listUserIds } from '../adminUsers/userDirectory.js';
import {
  getCached,
  setCached,
  invalidate,
  clearAll,
} from '../adminUsers/userDetailCache.js';
import {
  isAllowAll,
  describeFlags,
  ALLOW_ALL_FLAG,
} from '../adminUsers/accessFlags.js';
import {
  record as recordAudit,
  list as listAudit,
  AUDIT_DEGRADED_REASON,
  type AuditAction,
} from '../adminUsers/auditStore.js';
import {
  record as recordUsage,
  summary as usageSummary,
  type CallRecord,
} from '../adminUsers/usageTracker.js';
import {
  getDefaultIncidentTemplateId,
  setDefaultIncidentTemplateId,
} from '../adminUsers/templateConfigStore.js';

export const adminUsersRouter = Router();

// Every endpoint requires an authenticated admin session.
// Mirrors /api/ai/admin/* guard pattern from routes/ai.ts.
adminUsersRouter.use(requireSession, requireAdmin);

// Shared error→JSON helper. Same shape as routes/admin.ts.
function err(e: unknown, fallback: string) {
  if (e instanceof ITHubError) {
    return {
      status: e.status || 500,
      body: {
        error: {
          code: e.code,
          message_zh: e.upstreamMessage || fallback,
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'UNKNOWN', message_zh: fallback } },
  };
}

// Normalize a raw ITHub user payload to the AdminUserSummary shape.
function summarize(u: any) {
  const flags = Number(u?.UserAccessFlags ?? 0);
  return {
    UserId: Number(u?.UserId ?? u?.Id ?? 0),
    Name: u?.Name ?? '',
    Username: u?.Username ?? '',
    Email: u?.Email ?? '',
    Active: !!u?.Active,
    HasApiKey: !!u?.HasApiKey,
    ApiKeyActive: !!u?.ApiKeyActive,
    UserAccessFlags: flags,
    IsAllowAll: isAllowAll(flags),
    UserGroupIds: Array.isArray(u?.UserGroupIds) ? u.UserGroupIds.map(Number) : [],
    _unresolved: false,
  };
}

// ---------------------------------------------------------------------------
// GET /default-incident-template — admin override for AI-chat → ticket
// escalation. Falls back to ITHUB_DEFAULT_INCIDENT_TEMPLATE_ID env if the
// admin has not set one.
// ---------------------------------------------------------------------------
adminUsersRouter.get('/default-incident-template', (_req, res): Promise<void> => {
  res.json({ templateId: getDefaultIncidentTemplateId() });
  return Promise.resolve();
});

// ---------------------------------------------------------------------------
// POST /default-incident-template — set the escalation override.
// Body: { templateId: number | null }
// ---------------------------------------------------------------------------
adminUsersRouter.post('/default-incident-template', (req, res): Promise<void> => {
  const body = req.body ?? {};
  if (body.templateId === null || body.templateId === undefined) {
    setDefaultIncidentTemplateId(null);
    recordAudit({
      userId: 0,
      action: 'PERMISSIONS_UPDATED', // closest enum value; signals admin config change
      actor: req.session!.identity,
      detail: 'cleared default escalation template',
    });
    res.json({ templateId: null });
    return Promise.resolve();
  }
  const n = Number(body.templateId);
  if (!Number.isFinite(n) || n <= 0) {
    res.status(400).json({
      error: { code: 'INVALID', message_zh: 'templateId 必须是正整数或 null' },
    });
    return Promise.resolve();
  }
  setDefaultIncidentTemplateId(n);
  recordAudit({
    userId: 0,
    action: 'PERMISSIONS_UPDATED',
    actor: req.session!.identity,
    detail: `set default escalation template=${n}`,
  });
  res.json({ templateId: n });
  return Promise.resolve();
});

// ---------------------------------------------------------------------------
// GET /directory?seedIds=...
//
// Aggregates user IDs from UserGroups + seed + manual paste, fans out to
// GET /api/Security/Users/{id} (with cache) for each.
// ---------------------------------------------------------------------------
adminUsersRouter.get('/directory', async (req, res): Promise<void> => {
  const seedParam = String(req.query.seedIds ?? '');
  const manualIds = seedParam
    ? seedParam.split(',').map((s) => Number(s.trim())).filter(Number.isFinite)
    : [];

  try {
    const { ids, sources } = await listUserIds({
      accessToken: req.session!.accessToken,
      manualIds,
    });

    // Fan-out: cached hits return instantly, misses hit ITHub.
    // Individual failures (e.g. 403 for one user) don't break the whole list.
    const users = await Promise.all(
      ids.map(async (id) => {
        const cached = getCached(id);
        if (cached) return summarize(cached);
        try {
          const u = await ithubFetch<any>(`/api/Security/Users/${id}`, {
            accessToken: req.session!.accessToken,
          });
          setCached(id, u);
          return summarize(u);
        } catch {
          // Per-user fetch failed (e.g. 403/404). Surface as a placeholder
          // row so the admin sees "ID exists but I can't read it" instead
          // of the row silently disappearing.
          return {
            UserId: id,
            Name: '',
            Username: '',
            Email: '',
            Active: false,
            HasApiKey: false,
            ApiKeyActive: false,
            UserAccessFlags: 0,
            IsAllowAll: false,
            UserGroupIds: [],
            _unresolved: true,
          };
        }
      }),
    );

    res.json({ users, sources });
  } catch (e) {
    const { status, body } = err(e, '获取用户目录失败');
    res.status(status).json(body);
  }
});

// ---------------------------------------------------------------------------
// GET /user-groups — full list of ITHub user groups in the tenant.
//
// Needed by the lifecycle tab to render group checkboxes. Distinct from
// adminApi.getObservedGroups() which only returns groups we've seen
// attached to a customer we've resolved before.
// ---------------------------------------------------------------------------
adminUsersRouter.get('/user-groups', async (req, res): Promise<void> => {
  try {
    const data = await ithubFetch<any>('/api/Security/UserGroups', {
      accessToken: req.session!.accessToken,
    });
    const groups = Array.isArray(data) ? data : Array.isArray(data?.value) ? data.value : [];
    res.json({
      groups: groups.map((g: any) => ({
        UserGroupId: Number(g?.UserGroupId ?? g?.Id ?? 0),
        Name: String(g?.Name ?? g?.DisplayName ?? ''),
        Description: g?.Description ?? '',
      })),
    });
  } catch (e) {
    const { status, body } = err(e, '获取用户组列表失败');
    res.status(status).json(body);
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id
// ---------------------------------------------------------------------------
adminUsersRouter.get('/users/:id', async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: { code: 'INVALID', message_zh: '无效的用户 ID' } });
    return;
  }
  const cached = getCached(id);
  if (cached) {
    res.json({
      ...summarize(cached),
      CustomerTag: (cached as any)?.CustomerTag,
      Language: (cached as any)?.Language,
      TwoFactorAuthenticationEnabled: (cached as any)?.TwoFactorAuthenticationEnabled,
      FlagBreakdown: describeFlags(Number((cached as any)?.UserAccessFlags ?? 0)),
      _fromCache: true,
    });
    return;
  }
  try {
    const u = await ithubFetch<any>(`/api/Security/Users/${id}`, {
      accessToken: req.session!.accessToken,
    });
    setCached(id, u);
    res.json({
      ...summarize(u),
      CustomerTag: u?.CustomerTag,
      Language: u?.Language,
      TwoFactorAuthenticationEnabled: u?.TwoFactorAuthenticationEnabled,
      FlagBreakdown: describeFlags(Number(u?.UserAccessFlags ?? 0)),
      _fromCache: false,
    });
  } catch (e) {
    const { status, body } = err(e, '获取用户详情失败');
    res.status(status).json(body);
  }
});

// ---------------------------------------------------------------------------
// POST /users/:id/api-key — generate a new API key (ITHub rotates existing).
// Returns the literal key string. UI shows it once with a copy button.
// ---------------------------------------------------------------------------
adminUsersRouter.post('/users/:id/api-key', async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const key = await ithubFetch<string>(`/api/Security/Users/${id}/ApiKey`, {
      method: 'POST',
      accessToken: req.session!.accessToken,
    });
    invalidate(id);
    recordAudit({
      userId: id,
      action: 'API_KEY_CREATED',
      actor: req.session!.identity,
    });
    res.json({ apiKey: key });
  } catch (e) {
    const { status, body } = err(e, '生成 API Key 失败');
    res.status(status).json(body);
  }
});

// ---------------------------------------------------------------------------
// DELETE /users/:id/api-key — revoke the user's API key.
// ---------------------------------------------------------------------------
adminUsersRouter.delete('/users/:id/api-key', async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    await ithubFetch<boolean>(`/api/Security/Users/${id}/ApiKey`, {
      method: 'DELETE',
      accessToken: req.session!.accessToken,
    });
    invalidate(id);
    recordAudit({
      userId: id,
      action: 'API_KEY_REVOKED',
      actor: req.session!.identity,
    });
    res.json({ ok: true });
  } catch (e) {
    const { status, body } = err(e, '撤销 API Key 失败');
    res.status(status).json(body);
  }
});

// ---------------------------------------------------------------------------
// PUT /users/:id/permissions — set UserAccessFlags.
//
// ITHub PUT requires the full user object (SQL UPDATE, not PATCH), so we
// GET first, mutate the flag, then PUT back. Cache invalidation runs after
// the PUT so subsequent reads see fresh data.
// ---------------------------------------------------------------------------
adminUsersRouter.put('/users/:id/permissions', async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const flags = Number(req.body?.userAccessFlags);
  if (!Number.isFinite(flags)) {
    res.status(400).json({
      error: { code: 'INVALID', message_zh: '缺少 userAccessFlags' },
    });
    return;
  }
  try {
    const cur = await ithubFetch<any>(`/api/Security/Users/${id}`, {
      accessToken: req.session!.accessToken,
    });
    const updated = await ithubFetch<any>(`/api/Security/Users/${id}`, {
      method: 'PUT',
      accessToken: req.session!.accessToken,
      body: { ...cur, UserAccessFlags: flags },
    });
    invalidate(id);
    setCached(id, updated);
    recordAudit({
      userId: id,
      action: 'PERMISSIONS_UPDATED',
      actor: req.session!.identity,
      detail: flags === ALLOW_ALL_FLAG ? 'set ALLOW_ALL' : `flags=${flags}`,
    });
    res.json({
      user: {
        ...summarize(updated),
        FlagBreakdown: describeFlags(Number(updated?.UserAccessFlags ?? 0)),
      },
    });
  } catch (e) {
    const { status, body } = err(e, '更新权限失败');
    res.status(status).json(body);
  }
});

// ---------------------------------------------------------------------------
// PUT /users/:id/lifecycle — activate/deactivate and/or change group membership.
// ---------------------------------------------------------------------------
adminUsersRouter.put('/users/:id/lifecycle', async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { active, userGroupIds } = req.body ?? {};
  if (typeof active !== 'boolean' && !Array.isArray(userGroupIds)) {
    res.status(400).json({
      error: { code: 'INVALID', message_zh: '至少需要 active 或 userGroupIds 之一' },
    });
    return;
  }
  try {
    const cur = await ithubFetch<any>(`/api/Security/Users/${id}`, {
      accessToken: req.session!.accessToken,
    });
    const next: any = { ...cur };
    if (typeof active === 'boolean') next.Active = active;
    if (Array.isArray(userGroupIds)) next.UserGroupIds = userGroupIds.map(Number);
    const updated = await ithubFetch<any>(`/api/Security/Users/${id}`, {
      method: 'PUT',
      accessToken: req.session!.accessToken,
      body: next,
    });
    invalidate(id);
    setCached(id, updated);

    if (typeof active === 'boolean') {
      recordAudit({
        userId: id,
        action: active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        actor: req.session!.identity,
      });
    }
    if (Array.isArray(userGroupIds)) {
      recordAudit({
        userId: id,
        action: 'GROUP_CHANGED',
        actor: req.session!.identity,
        detail: `groups=${userGroupIds.join(',')}`,
      });
    }
    res.json({ user: summarize(updated) });
  } catch (e) {
    const { status, body } = err(e, '更新用户生命周期失败');
    res.status(status).json(body);
  }
});

// ---------------------------------------------------------------------------
// POST /users — create a new user.
// ---------------------------------------------------------------------------
adminUsersRouter.post('/users', async (req, res): Promise<void> => {
  const { username, name, email, password, userGroupIds } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({
      error: { code: 'INVALID', message_zh: '缺少 username/password' },
    });
    return;
  }
  try {
    const created = await ithubFetch<any>('/api/Security/Users', {
      method: 'POST',
      accessToken: req.session!.accessToken,
      body: {
        Username: username,
        Name: name ?? username,
        Email: email,
        Password: password,
        UserGroupIds: Array.isArray(userGroupIds) ? userGroupIds.map(Number) : [],
      },
    });
    const newId = Number(created?.UserId ?? created?.Id ?? 0);
    // Invalidate directory cache so a reload picks up the new id.
    clearAll();
    if (newId) setCached(newId, created);
    recordAudit({
      userId: newId,
      action: 'USER_CREATED',
      actor: req.session!.identity,
      detail: username,
    });
    res.json({ userId: newId, user: summarize(created) });
  } catch (e) {
    const { status, body } = err(e, '创建用户失败');
    res.status(status).json(body);
  }
});

// ---------------------------------------------------------------------------
// POST /users/:id/reset-password — STUB (ITHub endpoint not yet confirmed).
// Returns 501 so the UI can show "请到 ITHub 后台重置" instead of failing
// silently.
// ---------------------------------------------------------------------------
adminUsersRouter.post('/users/:id/reset-password', async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  recordAudit({
    userId: id,
    action: 'PASSWORD_RESET_REQUESTED',
    actor: req.session!.identity,
  });
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message_zh: 'ITHub 密码重置端点未在探测范围，请管理员在 ITHub 后台重置',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /usage/summary?userId= — aggregated local usage stats.
// ---------------------------------------------------------------------------
adminUsersRouter.get('/usage/summary', async (req, res): Promise<void> => {
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  const data = usageSummary(userId);
  res.json(data);
});

// ---------------------------------------------------------------------------
// POST /usage/log — import a single call record (admin/script driven).
// ---------------------------------------------------------------------------
adminUsersRouter.post('/usage/log', async (req, res): Promise<void> => {
  const { userId, endpoint, statusCode, latencyMs } = req.body ?? {};
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0 || typeof endpoint !== 'string') {
    res.status(400).json({
      error: { code: 'INVALID', message_zh: '缺少 userId/endpoint' },
    });
    return;
  }
  const record: Omit<CallRecord, 'ts'> = {
    userId: uid,
    endpoint,
    statusCode: Number(statusCode ?? 0),
    latencyMs: Number(latencyMs ?? 0),
  };
  recordUsage(record);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /audit?userId=&limit= — local audit list with degraded marker.
// ---------------------------------------------------------------------------
adminUsersRouter.get('/audit', async (req, res): Promise<void> => {
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const events = listAudit({ userId, limit });
  res.json({
    events,
    degraded: true,
    reason: AUDIT_DEGRADED_REASON,
  });
});