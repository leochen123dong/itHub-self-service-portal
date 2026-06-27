import { Router } from 'express';
import { ithubFetch } from '../http/ithubClient.js';
import { ITHubError } from '../http/errors.js';
import { config } from '../config.js';
import { createSession, deleteSession } from '../session/store.js';
import { requireSession } from '../session/middleware.js';
import { isAdmin } from '../middleware/admin.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res): Promise<void> => {
  const { identity, password } = req.body ?? {};
  const id = (identity || config.ithub.demoIdentity || '').toString().trim();
  const pw = (password || config.ithub.demoPassword || '').toString();
  if (!id || !pw) {
    res.status(400).json({
      error: { code: 'MISSING_CREDENTIALS', message_zh: '请输入账号和密码' },
    });
    return;
  }
  try {
    const result = await ithubFetch<{
      AccessToken: string;
      UserId: number;
      UserName: string;
      CustomerTag: string;
      PasswordExpired?: boolean;
    }>('/api/Security/AccessTokens', {
      method: 'POST',
      body: { Identity: id, Password: pw },
    });
    const sid = createSession({
      accessToken: result.AccessToken,
      userId: result.UserId,
      userName: result.UserName,
      identity: id,
      customerTag: result.CustomerTag || config.ithub.customerTag,
    });
    res.cookie(config.session.cookieName, sid, {
      httpOnly: true,
      sameSite: config.session.cookieSameSite,
      secure: config.session.cookieSecure,
      maxAge: config.session.ttlHours * 3600_000,
      path: '/',
    });
    res.json({
      userId: result.UserId,
      userName: result.UserName,
      customerTag: result.CustomerTag,
      passwordExpired: !!result.PasswordExpired,
    });
  } catch (err) {
    if (err instanceof ITHubError) {
      const zh =
        err.status === 401 || err.status === 403
          ? '账号或密码错误'
          : err.status >= 500
          ? '登录服务暂不可用，请稍后再试'
          : err.upstreamMessage || '登录失败';
      res.status(err.status || 500).json({
        error: { code: err.code, message_zh: zh },
      });
      return;
    }
    res.status(500).json({ error: { code: 'UNKNOWN', message_zh: '登录失败' } });
  }
});

authRouter.post('/logout', (req, res) => {
  const sid = (req as any).cookies?.[config.session.cookieName];
  deleteSession(sid);
  res.clearCookie(config.session.cookieName, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireSession, (req, res) => {
  const s = req.session!;
  res.json({
    userId: s.userId,
    userName: s.userName,
    identity: s.identity,
    customerTag: s.customerTag,
    isAdmin: isAdmin(s.userName, s.identity),
  });
});

// Demo credentials hint for the login screen
authRouter.get('/demo-hint', (_req, res) => {
  res.json({
    identity: config.ithub.demoIdentity,
    hasPassword: !!config.ithub.demoPassword,
  });
});