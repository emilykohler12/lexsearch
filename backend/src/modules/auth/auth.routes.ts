import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AuthController } from './auth.controller.js';

export function authRouter(controller: AuthController, loginAttempts = 8) {
  // Only the failed attempts count: the lawyer logging in again and again is not an attack, a guessing loop is.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: loginAttempts,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      controller.blocked(req);
      res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Demasiados intentos. Esperá unos minutos antes de volver a probar.' } });
    },
  });

  const router = Router();
  router.get('/me', controller.me);
  router.post('/login', loginLimiter, controller.login);
  router.post('/logout', controller.logout);
  // The recent logins are only for whoever is logged in.
  router.get('/activity', controller.requireSession, controller.activity);
  return router;
}
