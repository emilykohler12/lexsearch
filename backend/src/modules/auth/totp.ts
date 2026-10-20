import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Second factor: the six-digit code of an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 30 seconds, 6 digits),
 * the same that Google Authenticator, Microsoft Authenticator, Aegis or 1Password generate. No dependency: it is
 * a handful of lines over node:crypto.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
/** The shared secret has to have at least 80 bits (16 base32 characters); a new one has 160. */
export const MIN_SECRET_CHARS = 16;

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** The bytes of a base32 text (spaces, dashes, case and «=» padding ignored), or null when it isn't one. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean === '') return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

export const isValidTotpSecret = (secret: string): boolean => secret.replace(/[\s-]/g, '').length >= MIN_SECRET_CHARS && base32Decode(secret) !== null;

/** The code for one 30-second step. */
export function totpAt(key: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepAt = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * The step of the code when it is right, or null. It accepts the step before and the one after (clocks that are a bit
 * off), and never a step that was already used (`lastUsedStep`): a code seen once, by whoever, does not open twice.
 */
export function verifyTotp(secret: string, code: string, nowMs: number, lastUsedStep: number): number | null {
  const key = base32Decode(secret);
  if (!key || !/^\d{6}$/.test(code)) return null;
  const current = stepAt(nowMs);
  let accepted: number | null = null;
  // The three are always compared, so the time doesn't say which one was close.
  for (const step of [current - 1, current, current + 1]) {
    const matches = timingSafeEqual(Buffer.from(totpAt(key, step)), Buffer.from(code));
    if (matches && step > lastUsedStep) accepted = step;
  }
  return accepted;
}

/** What the authenticator app reads (the address a QR code holds). */
export function otpauthUri(secret: string, account: string, issuer = 'LexSearch'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret.replace(/[\s-]/g, '')}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
