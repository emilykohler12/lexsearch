import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Passwords are stored as «scrypt:N:r:p:salt:hash» (salt and hash in base64url). It has no «$» or quotes, so it
 * can go in the .env file and through docker compose without being altered.
 */
const COST = { N: 2 ** 17, r: 8, p: 1 } as const;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
/** scrypt needs 128 * N * r bytes: 128 MB for the cost above; the limit leaves room and refuses anything bigger. */
const MAX_MEMORY = 256 * 1024 * 1024;

export const MIN_PASSWORD_CHARS = 12;
export const MAX_PASSWORD_CHARS = 200;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { ...options, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join(':');
}

/** The pieces of a stored hash, or null when it isn't one. */
export function parseHash(stored: string): { N: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0) || N > 2 ** 17 || N < 2 ** 10 || r > 16 || p > 4) return null;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const key = Buffer.from(parts[5]!, 'base64url');
  return salt.length >= 8 && key.length === KEY_BYTES ? { N, r, p, salt, key } : null;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, { N: parsed.N, r: parsed.r, p: parsed.p });
  return timingSafeEqual(key, parsed.key);
}
