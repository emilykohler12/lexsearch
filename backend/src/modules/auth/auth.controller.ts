import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { parseInput } from '../../lib/validation.js';
import { readCookie, SESSION_COOKIE, type AuthService } from './auth.service.js';
import { MAX_PASSWORD_CHARS } from './password.js';

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Escribí tu usuario').max(100),
  password: z.string().min(1, 'Escribí tu contraseña').max(MAX_PASSWORD_CHARS),
  /** The six digits of the authenticator app; only asked when the second factor is on. */
  code: z.string().trim().max(10).default(''),
});

/**
 * With no `auth` (no password set in the .env, only allowed outside production) everything is open, as it was
 * before there was a login.
 */
export class AuthController {
  constructor(
    private readonly auth: AuthService | null,
    private readonly logger: Logger,
  ) {}

  private token = (req: Request) => readCookie(req.headers.cookie, SESSION_COOKIE);

  /** The address as the server sees it (the real one behind the proxies: see TRUST_PROXY_HOPS). */
  private ip = (req: Request) => req.ip ?? 'desconocida';

  me = (req: Request, res: Response) => {
    if (!this.auth) return void res.json({ authRequired: false, authenticated: true, username: null, totpRequired: false });
    const authenticated = this.auth.check(this.token(req));
    res.json({ authRequired: true, authenticated, username: authenticated ? this.auth.username : null, totpRequired: this.auth.totpRequired });
  };

  login = async (req: Request, res: Response) => {
    if (!this.auth) return void res.json({ authRequired: false, authenticated: true, username: null, totpRequired: false });
    const { username, password, code } = parseInput(loginSchema, req.body);
    const ip = this.ip(req);
    try {
      const { token, security } = await this.auth.login(username, password, code, ip);
      // Ids and addresses only: never the user, the password or the code that was typed.
      this.logger.info({ ip }, 'Login');
      res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions);
      res.json({ authRequired: true, authenticated: true, username: this.auth.username, totpRequired: this.auth.totpRequired, security });
    } catch (error) {
      if (error instanceof UnauthorizedError) this.logger.warn({ ip }, 'Failed login');
      throw error;
    }
  };

  logout = (req: Request, res: Response) => {
    this.auth?.logout(this.token(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  };

  /** The recent logins, the failed ones and the blocked ones, for the lawyer to look at. */
  activity = (_req: Request, res: Response) => {
    res.json({ events: (this.auth?.recentEvents() ?? []).map((event) => ({ at: new Date(event.at).toISOString(), kind: event.kind, ip: event.ip })) });
  };

  /** Called by the limiter when it stops a login: that is also something to see in the log. */
  blocked = (req: Request) => {
    this.auth?.recordBlocked(this.ip(req));
    this.logger.warn({ ip: this.ip(req) }, 'Login blocked: too many failed attempts');
  };

  /** Everything behind it needs an open session. */
  requireSession = (req: Request, _res: Response, next: NextFunction) => {
    if (this.auth && !this.auth.check(this.token(req))) throw new UnauthorizedError();
    next();
  };
}
