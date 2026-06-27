import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    customerTag: config.ithub.customerTag,
    aiProfileId: config.ai.profileId ?? null,
    kbId: config.ai.kbId ?? null,
    time: new Date().toISOString(),
  });
});

healthRouter.get('/debug/config', (_req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV ?? '(unset)',
    hasExternalOrigin: config.hasExternalOrigin,
    webOrigins: config.webOrigins,
    cookieSameSite: config.session.cookieSameSite,
    cookieSecure: config.session.cookieSecure,
    commitHint: 'cookie-fix-v3',
  });
});

// TEMP: emit Set-Cookie with current config so we can curl-verify the attributes
// without needing real ITHub creds. Remove after debugging.
healthRouter.get('/debug/test-cookie', (_req, res) => {
  res.cookie(config.session.cookieName, 'test-value-12345', {
    httpOnly: true,
    sameSite: config.session.cookieSameSite,
    secure: config.session.cookieSecure,
    maxAge: 60_000,
    path: '/',
  });
  res.json({ ok: true });
});