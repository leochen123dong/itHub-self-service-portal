import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

/**
 * Gates admin-only routes. The user's ITHub identity (login identity or
 * upstream userName) must appear in ADMIN_IDENTITY (comma-separated list in
 * env). The list is empty by default so misconfigured deployments don't
 * accidentally expose admin data.
 *
 * We accept either the typed-in identity or the upstream UserName so admins
 * can be configured with whichever string the operator has on hand.
 */
function matches(session: { userName?: string; identity?: string } | undefined): boolean {
  if (!session) return false;
  const allowed = config.admin.identities;
  if (allowed.length === 0) return false;
  return (
    (!!session.userName && allowed.includes(session.userName)) ||
    (!!session.identity && allowed.includes(session.identity))
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message_zh: '请先登录' },
    });
    return;
  }
  if (!matches(req.session)) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message_zh: '需要管理员权限' },
    });
    return;
  }
  next();
}

export function isAdmin(
  userName: string | undefined,
  identity?: string,
): boolean {
  return matches({ userName, identity });
}