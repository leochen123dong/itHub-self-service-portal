import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { requireSession } from '../session/middleware.js';
import {
  getVipGroupIds,
  setVipGroupIds,
} from '../ai/vipConfigStore.js';
import { clearCache as clearVipCache } from '../ai/vipCache.js';

export const adminRouter = Router();

function err(e: unknown, fallback: string) {
  if (e instanceof ITHubError) {
    return {
      status: e.status || 500,
      body: { error: { code: e.code, message_zh: e.upstreamMessage || fallback } },
    };
  }
  return { status: 500, body: { error: { code: 'UNKNOWN', message_zh: fallback } } };
}

// Return every ITHub user group in the tenant plus the group's current
// VIP-flag selection. The admin uses this to populate the checkbox list.
// Demo scope: just requireSession. In production, gate this behind
// requireAdmin (mirrors /api/ai/admin/stats in routes/ai.ts).
adminRouter.get('/user-groups', requireSession, async (req, res): Promise<void> => {
  try {
    // ITHub endpoint discovered by probing /api/Security/UserGroups — returns
    // all user groups in the tenant, scoped by the customerTag query string
    // that ithubFetch already appends. No ApiKey needed for read.
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
      vipGroupIds: getVipGroupIds(),
    });
  } catch (e) {
    const { status, body } = err(e, '获取用户组列表失败');
    res.status(status).json(body);
  }
});

// Replace the VIP-flag set. POST body: { groupIds: number[] }.
// Caller (admin UI) submits only the ids it wants flagged — clearing the
// list means "no group is VIP", which the render treats as "show no
// badges". Side effect: clear the per-customer cache so list/detail
// refresh reflects the new flag set immediately.
adminRouter.post('/vip-groups', requireSession, async (req, res): Promise<void> => {
  const ids = (req.body ?? {}).groupIds;
  if (!Array.isArray(ids)) {
    res.status(400).json({
      error: { code: 'INVALID', message_zh: '缺少 groupIds 数组' },
    });
    return;
  }
  setVipGroupIds(ids as number[]);
  clearVipCache();
  res.json({ vipGroupIds: getVipGroupIds() });
});
