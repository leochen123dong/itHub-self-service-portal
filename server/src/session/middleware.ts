import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { getSession, type SessionData } from './store.js';

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionData;
  }
}

export function sessionMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const sid = (req as any).cookies?.[config.session.cookieName];
  req.session = getSession(sid);
  next();
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message_zh: '请先登录' },
    });
    return;
  }
  next();
}