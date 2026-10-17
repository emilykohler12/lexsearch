import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ContradictionsController } from './contradictions.controller.js';

/** Mounted at /api/cases: the contradictions belong to an expediente. */
export function contradictionsRouter(controller: ContradictionsController) {
  // Each comparison reads several documents with the model: keep bursts in check.
  const analyzeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiados análisis seguidos. Esperá un minuto.' } },
  });

  const router = Router();
  router.get('/:id/contradictions', controller.list);
  router.post('/:id/contradictions', controller.create);
  router.post('/:id/contradictions/analyze', analyzeLimiter, controller.analyze);
  router.patch('/:id/contradictions/:contradictionId', controller.updateNote);
  router.delete('/:id/contradictions/:contradictionId', controller.delete);
  return router;
}
