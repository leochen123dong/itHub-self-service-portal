import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    customerTag: config.ithub.customerTag,
    aiBackend: config.minimax.enabled ? 'MiniMax' : 'ITHub',
    aiModel: config.minimax.enabled ? config.minimax.model : null,
    kbId: config.ai.kbId ?? null,
    time: new Date().toISOString(),
  });
});