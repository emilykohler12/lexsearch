import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { EstimatesController } from './estimates.controller.js';

export function estimatesRouter(controller: EstimatesController) {
  // Every analysis is a search plus a call to the model.
  const analyzeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas estimaciones seguidas. Esperá un minuto.' } },
  });

  const router = Router();
  router.get('/', controller.list);
  router.post('/analyze', analyzeLimiter, controller.analyze);
  router.post('/', controller.save);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.updateNote);
  router.delete('/:id', controller.delete);
  return router;
}
