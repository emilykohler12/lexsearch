import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { DraftsController } from './drafts.controller.js';

export function draftsRouter(controller: DraftsController) {
  // Each draft is an agent run with several model calls: keep bursts in check.
  const createLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiados borradores seguidos. Esperá un minuto.' } },
  });

  const router = Router();
  router.get('/', controller.list);
  router.post('/', createLimiter, controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.delete);
  router.get('/:id/docx', controller.downloadDocx);
  return router;
}
