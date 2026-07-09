import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { requireSession } from '../session/middleware.js';
import { config } from '../config.js';
import {
  getVipGroupIds,
  setVipGroupIds,
} from '../ai/vipConfigStore.js';
import { clearCache as clearVipCache } from '../ai/vipCache.js';
import {
  getObservedGroups,
  recordGroups as recordObservedGroups,
} from '../ai/vipGroupRegistry.js';

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

// Walk every observed user-group via the customerUserGroups field of each
// unique ticket-creator. We don't talk to /api/Security/UserGroups
// directly because that endpoint is POST-only on this tenant and we have
// no way to enumerate its body shape without live credentials. We populate
// the registry indirectly via the same per-customer lookup the VIP
// resolver uses.
//
// Cold-start strategy: if the registry is empty when admin hits the page,
// do a one-shot warm-up by listing the first page of tickets and calling
// /Security/Users/{id} for each unique CustomerId. After that the
// registry keeps growing in the background as users navigate the ticket
// list.
async function warmUpRegistry(accessToken: string): Promise<void> {
  if (!config.ithub.apiKey) return;
  const ticketRes = await ithubFetch<any>(
    `/api/ServiceDesk/Customers/${config.ithub.customerTag}/Tickets`,
    { accessToken, query: { offset: 0, count: 50 } },
  );
  const tickets = Array.isArray(ticketRes) ? ticketRes : [];
  // Tickets expose `CustomerId` (the customer organization — not a person)
  // and `CreatedBy.ItemId` (the actual user who filed the ticket).
  // /Security/Users/{id} expects a user id, so we key on CreatedBy.ItemId.
  const ids = [
    ...new Set(
      tickets
        .map((t: any) => Number(t?.CreatedBy?.ItemId))
        .filter((n: number) => Number.isFinite(n) && n > 0),
    ),
  ];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const u = await ithubFetch<any>(`/api/Security/Users/${id}`, {
          accessToken,
        
        callerIdentity: 'anon',
        callerUserId: 0,});
        const groups = Array.isArray(u?.UserGroups) ? u.UserGroups : [];
        recordObservedGroups(groups);
      } catch {
        // VIP lookup already negative-caches via vipCache; this
        // call site doesn't need its own cache layer for the demo.
      }
    }),
  );
}

// Return the running registry of observed ITHub user groups + the
// currently selected VIP flag set. Admin uses this to populate the
// checkbox list. Demo scope: just requireSession.
adminRouter.get('/observed-groups', requireSession, async (req, res): Promise<void> => {
  try {
    if (getObservedGroups().length === 0) {
      await warmUpRegistry(req.session!.accessToken);
    }
    res.json({
      groups: getObservedGroups(),
      vipGroupIds: getVipGroupIds(),
    });
  } catch (e) {
    const { status, body } = err(e, '获取用户组列表失败');
    res.status(status).json(body);
  }
});

// Replace the VIP-flag set. POST body: { groupIds: number[] }.
// Side effect: clear the per-customer cache so list/detail refresh
// reflects the new flag set immediately.
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
