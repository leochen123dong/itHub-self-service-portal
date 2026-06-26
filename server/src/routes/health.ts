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