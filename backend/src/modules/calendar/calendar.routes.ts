import { Router } from 'express';
import type { CalendarController } from './calendar.controller.js';

export function calendarRouter(controller: CalendarController) {
  const router = Router();
  router.get('/', controller.overview);
  router.post('/non-working-days', controller.create);
  router.put('/non-working-days/:id', controller.update);
  router.delete('/non-working-days/:id', controller.delete);
  return router;
}
