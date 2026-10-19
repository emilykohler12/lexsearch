import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { HearingsController } from './hearings.controller.js';

/** Requests per minute: for each answer or reply (one call to the model each), and for starting or finishing a practice. */
export interface HearingLimits {
  turns: number;
  heavy: number;
}

export const DEFAULT_HEARING_LIMITS: HearingLimits = { turns: 20, heavy: 10 };

export function hearingsRouter(controller: HearingsController, limits: HearingLimits = DEFAULT_HEARING_LIMITS) {
  // Every turn is a call to the model. A real practice is a few answers a minute: this only stops a runaway loop.
  const turnLimiter = rateLimit({
    windowMs: 60_000,
    limit: limits.turns,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas intervenciones seguidas. Esperá un minuto.' } },
  });
  // Starting a practice or asking for the feedback reads the whole brief.
  const heavyLimiter = rateLimit({
    windowMs: 60_000,
    limit: limits.heavy,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiados pedidos seguidos. Esperá un minuto.' } },
  });

  const router = Router();
  router.get('/', controller.list);
  router.post('/', heavyLimiter, controller.create);
  router.get('/:id', controller.get);
  router.post('/:id/turns', turnLimiter, controller.sendTurn);
  router.post('/:id/reply', turnLimiter, controller.reply);
  router.post('/:id/finish', heavyLimiter, controller.finish);
  router.delete('/:id', controller.delete);
  return router;
}
