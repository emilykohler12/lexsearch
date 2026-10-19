import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { NormativeController } from './normative.controller.js';

export function normativeRouter(controller: NormativeController) {
  // Each check reads a public site and may call the model: keep bursts in check.
  const refreshLimiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: 6,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas búsquedas seguidas. Esperá unos minutos.' } },
  });

  const router = Router();
  router.get('/status', controller.status);
  router.post('/refresh', refreshLimiter, controller.refresh);
  router.get('/alerts', controller.listAlerts);
  router.get('/alerts/unread-count', controller.unreadCount);
  router.post('/alerts/read-all', controller.markAllSeen);
  router.patch('/alerts/:id', controller.updateAlert);
  router.get('/items', controller.listItems);
  router.get('/topics', controller.listTopics);
  router.post('/topics', controller.createTopic);
  router.patch('/topics/:id', controller.updateTopic);
  router.delete('/topics/:id', controller.deleteTopic);
  return router;
}
