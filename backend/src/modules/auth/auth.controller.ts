import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../lib/errors.js';
import { parseInput } from '../../lib/validation.js';
import { readCookie, SESSION_COOKIE, type AuthService } from './auth.service.js';
import { MAX_PASSWORD_CHARS } from './password.js';

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Escribí tu usuario').max(100),
  password: z.string().min(1, 'Escribí tu contraseña').max(MAX_PASSWORD_CHARS),
});

/**
 * With no `auth` (no password set in the .env, only allowed outside production) everything is open, as it was
 * before there was a login.
 */
export class AuthController {
  constructor(private readonly auth: AuthService | null) {}

  private token = (req: Request) => readCookie(req.headers.cookie, SESSION_COOKIE);

  me = (req: Request, res: Response) => {
    if (!this.auth) return void res.json({ authRequired: false, authenticated: true, username: null });
    const authenticated = this.auth.check(this.token(req));
    res.json({ authRequired: true, authenticated, username: authenticated ? this.auth.username : null });
  };

  login = async (req: Request, res: Response) => {
    if (!this.auth) return void res.json({ authRequired: false, authenticated: true, username: null });
    const { username, password } = parseInput(loginSchema, req.body);
    const token = await this.auth.login(username, password);
    res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions);
    res.json({ authRequired: true, authenticated: true, username: this.auth.username });
  };

  logout = (req: Request, res: Response) => {
    this.auth?.logout(this.token(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  };

  /** Everything behind it needs an open session. */
  requireSession = (req: Request, _res: Response, next: NextFunction) => {
    if (this.auth && !this.auth.check(this.token(req))) throw new UnauthorizedError();
    next();
  };
}
