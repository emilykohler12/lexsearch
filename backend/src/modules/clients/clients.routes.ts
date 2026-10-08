import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ClientsController } from './clients.controller.js';

export function clientsRouter(controller: ClientsController) {
  // Each analysis is a call to the model: keep bursts in check.
  const analyzeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiados análisis seguidos. Esperá un minuto.' } },
  });

  const router = Router();
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.post('/analyze-notes', analyzeLimiter, controller.analyzeNotes);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.delete);
  return router;
}
