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
    hasLocalhostOrigin: config.hasLocalhostOrigin,
    webOrigins: config.webOrigins,
    cookieSameSite: config.session.cookieSameSite,
    cookieSecure: config.session.cookieSecure,
    commitHint: 'cookie-fix-v2', // bump on deploy to confirm latest code is live
  });
});