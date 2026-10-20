import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from './password.js';

/** The access of the lawyer: one user and one password, set in the .env file (see D26). */
export interface AuthConfig {
  username: string;
  /** «scrypt:…» as written by `npm run auth:hash`. */
  passwordHash: string;
  /** A session closes after this many hours without use. */
  idleHours: number;
  /** The cookie travels only over HTTPS. */
  secureCookie: boolean;
}

export const SESSION_COOKIE = 'lexsearch_session';
const MAX_SESSIONS = 20;
/** A session never lasts more than this, however much it is used (a stolen token can't be kept alive for ever). */
const MAX_SESSION_HOURS = 24 * 7;

const digest = (value: string) => createHash('sha256').update(value).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * Sessions live in memory: restarting the server closes them (one lawyer, one process), and a closed one can
 * not be used again. The cookie holds a random token; only its hash is kept here.
 */
export class AuthService {
  private readonly sessions = new Map<string, { expires: number; born: number }>();
  /** A hash to compare against when the user doesn't exist, so a wrong user and a wrong password take the same time. */
  private readonly decoy: Promise<string>;

  constructor(
    private readonly config: AuthConfig,
    private readonly now: () => number = Date.now,
  ) {
    // Made now, not at the first wrong user: that first answer would be the only one that takes twice as long.
    this.decoy = hashPassword(randomBytes(16).toString('hex'));
  }

  get cookieOptions() {
    return { httpOnly: true, sameSite: 'strict' as const, secure: this.config.secureCookie, path: '/', maxAge: MAX_SESSION_HOURS * 3_600_000 };
  }

  get username(): string {
    return this.config.username;
  }

  /** Returns the session token, or throws the same error for a wrong user and a wrong password. */
  async login(username: string, password: string): Promise<string> {
    const userOk = safeEqual(username, this.config.username);
    const passwordOk = await verifyPassword(password, userOk ? this.config.passwordHash : await this.decoy);
    if (!userOk || !passwordOk) throw new UnauthorizedError('Usuario o contraseña incorrectos.');

    this.prune();
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(digest(token).toString('base64url'), { expires: this.now() + this.config.idleHours * 3_600_000, born: this.now() });
    // The oldest sessions go first when there are too many.
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
    return token;
  }

  /** True while the session is open; using it extends it. */
  check(token: string | undefined): boolean {
    if (!token) return false;
    const key = digest(token).toString('base64url');
    const session = this.sessions.get(key);
    if (!session) return false;
    if (session.expires <= this.now() || session.born + MAX_SESSION_HOURS * 3_600_000 <= this.now()) {
      this.sessions.delete(key);
      return false;
    }
    session.expires = this.now() + this.config.idleHours * 3_600_000;
    return true;
  }

  logout(token: string | undefined): void {
    if (token) this.sessions.delete(digest(token).toString('base64url'));
  }

  private prune(): void {
    for (const [key, session] of this.sessions) if (session.expires <= this.now()) this.sessions.delete(key);
  }
}

/** The value of a cookie in the «Cookie» header of a request. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}
