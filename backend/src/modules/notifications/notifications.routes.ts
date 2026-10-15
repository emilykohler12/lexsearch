import { Router } from 'express';
import type { NotificationsController } from './notifications.controller.js';

export function notificationsRouter(controller: NotificationsController) {
  const router = Router();
  router.get('/', controller.listUnread);
  router.post('/read-all', controller.markAllRead);
  router.post('/:id/read', controller.markRead);
  return router;
}
