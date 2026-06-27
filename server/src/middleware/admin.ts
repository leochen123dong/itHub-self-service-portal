import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

/**
 * Gates admin-only routes. The user's ITHub identity (userName) must appear
 * in ADMIN_IDENTITY (comma-separated list in env). The list is empty by
 * default so misconfigured deployments don't accidentally expose admin data.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message_zh: '请先登录' },
    });
    return;
  }
  const allowed = config.admin.identities;
  if (allowed.length === 0 || !allowed.includes(req.session.userName)) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message_zh: '需要管理员权限' },
    });
    return;
  }
  next();
}

export function isAdmin(userName: string | undefined): boolean {
  if (!userName) return false;
  const allowed = config.admin.identities;
  return allowed.length > 0 && allowed.includes(userName);
}