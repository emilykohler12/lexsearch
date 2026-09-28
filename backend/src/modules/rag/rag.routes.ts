import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RagController } from './rag.controller.js';

export function ragRouter(controller: RagController) {
  // Each answer costs money: cap bursts even if the app is only reachable locally.
  const askLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas consultas seguidas. Esperá un minuto.' } },
  });

  const router = Router();
  router.post('/search', controller.search);
  router.post('/ask', askLimiter, controller.ask);
  return router;
}
