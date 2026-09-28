import { Router } from 'express';
import type { InteractionsController } from './interactions.controller.js';

export function interactionsRouter(controller: InteractionsController) {
  const router = Router();
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  return router;
}
