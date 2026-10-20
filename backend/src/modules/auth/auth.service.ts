import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { verifyTotp } from './totp.js';

/** The access of the lawyer: one user and one password, set in the .env file (see D26). */
export interface AuthConfig {
  username: string;
  /** «scrypt:…» as written by `npm run auth:hash`. */
  passwordHash: string;
  /** Shared secret of the authenticator app (base32), as written by `npm run auth:totp`. Without it there is no second factor. */
  totpSecret?: string | undefined;
  /** A session closes after this many hours without use. */
  idleHours: number;
  /** The cookie travels only over HTTPS. */
  secureCookie: boolean;
}

export const SESSION_COOKIE = 'lexsearch_session';
const MAX_SESSIONS = 20;
/** A session never lasts more than this, however much it is used (a stolen token can't be kept alive for ever). */
const MAX_SESSION_HOURS = 24 * 7;
const MAX_EVENTS = 100;

const digest = (value: string) => createHash('sha256').update(value).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** What happened at the door: a login that worked, one that failed, or one that the limit stopped. */
export type AccessEventKind = 'LOGIN_OK' | 'LOGIN_FAILED' | 'LOGIN_BLOCKED';

export interface AccessEvent {
  at: number;
  kind: AccessEventKind;
  ip: string;
}

/** What the lawyer is told when she logs in: the failed attempts there were since the previous time. */
export interface SecuritySummary {
  failedAttempts: number;
  lastFailedAt: number | null;
  lastFailedIp: string | null;
  previousLoginAt: number | null;
}

/**
 * Sessions live in memory: restarting the server closes them (one lawyer, one process), and a closed one can
 * not be used again. The cookie holds a random token; only its hash is kept here.
 */
export class AuthService {
  private readonly sessions = new Map<string, { expires: number; born: number }>();
  /** The recent access events (in memory: the permanent trail is in the log). */
  private readonly events: AccessEvent[] = [];
  /** The last step of the second factor that was used: a code opens once. */
  private lastTotpStep = 0;
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

  /** Whether the login asks for the code of the authenticator app. */
  get totpRequired(): boolean {
    return this.config.totpSecret !== undefined;
  }

  /**
   * Returns the session token. A wrong user, a wrong password and a wrong code give the same error, so nobody
   * learns which one of them was right.
   */
  async login(username: string, password: string, code: string, ip: string): Promise<{ token: string; security: SecuritySummary }> {
    const userOk = safeEqual(username, this.config.username);
    const passwordOk = await verifyPassword(password, userOk ? this.config.passwordHash : await this.decoy);
    // The code is always checked when there is a second factor, even if the password was wrong (same time either way).
    const step = this.config.totpSecret ? verifyTotp(this.config.totpSecret, code, this.now(), this.lastTotpStep) : 0;
    if (!userOk || !passwordOk || step === null) {
      this.record('LOGIN_FAILED', ip);
      throw new UnauthorizedError(this.totpRequired ? 'Usuario, contraseña o código incorrectos.' : 'Usuario o contraseña incorrectos.');
    }
    if (step > 0) this.lastTotpStep = step;

    const security = this.summarize();
    this.record('LOGIN_OK', ip);
    this.prune();
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(digest(token).toString('base64url'), { expires: this.now() + this.config.idleHours * 3_600_000, born: this.now() });
    // The oldest sessions go first when there are too many.
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
    return { token, security };
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

  /** A login stopped by the limit of attempts (the limiter calls it). */
  recordBlocked(ip: string): void {
    this.record('LOGIN_BLOCKED', ip);
  }

  /** The recent events, the latest first. */
  recentEvents(limit = 30): AccessEvent[] {
    return this.events.slice(-limit).reverse();
  }

  private record(kind: AccessEventKind, ip: string): void {
    this.events.push({ at: this.now(), kind, ip });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  /** The failed attempts since the last login that worked. */
  private summarize(): SecuritySummary {
    // By order, not by time: two events can share the same millisecond.
    const lastOkIndex = this.events.findLastIndex((event) => event.kind === 'LOGIN_OK');
    const lastOk = lastOkIndex >= 0 ? this.events[lastOkIndex] : undefined;
    const failed = this.events.slice(lastOkIndex + 1).filter((event) => event.kind !== 'LOGIN_OK');
    const last = failed.at(-1);
    return { failedAttempts: failed.length, lastFailedAt: last?.at ?? null, lastFailedIp: last?.ip ?? null, previousLoginAt: lastOk?.at ?? null };
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
