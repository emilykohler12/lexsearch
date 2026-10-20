import { describe, expect, it } from 'vitest';
import { authProblems } from '../../src/config/env.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { base32Decode, base32Encode, generateTotpSecret, isValidTotpSecret, otpauthUri, stepAt, totpAt, verifyTotp } from '../../src/modules/auth/totp.js';

// The key of the examples of RFC 6238: the ASCII text «12345678901234567890».
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_KEY = Buffer.from('12345678901234567890');

describe('totp', () => {
  it('gives the codes of the examples of RFC 6238 (SHA-1, last six digits)', () => {
    const at = (seconds: number) => totpAt(RFC_KEY, stepAt(seconds * 1000));
    expect(at(59)).toBe('287082');
    expect(at(1_111_111_109)).toBe('081804');
    expect(at(1_111_111_111)).toBe('050471');
    expect(at(1_234_567_890)).toBe('005924');
    expect(at(2_000_000_000)).toBe('279037');
    expect(at(20_000_000_000)).toBe('353130');
  });

  it('encodes and decodes base32, ignoring spaces, case and padding', () => {
    expect(base32Encode(RFC_KEY)).toBe(RFC_SECRET);
    expect(base32Decode('gezd gnbv-GY3TQOJQ====')?.toString()).toBe('1234567890');
    expect(base32Decode('no es base32 1')).toBeNull();
    expect(base32Decode('')).toBeNull();
  });

  it('makes secrets of 160 bits that are valid, and refuses short or wrong ones', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(isValidTotpSecret(secret)).toBe(true);
    expect(isValidTotpSecret('ABCDEFG')).toBe(false);
    expect(isValidTotpSecret('1'.repeat(20))).toBe(false);
  });

  it('accepts the step before and after, but nothing further, and a step only once', () => {
    const now = 1_700_000_000_000;
    const current = stepAt(now);
    const code = (step: number) => totpAt(RFC_KEY, step);
    expect(verifyTotp(RFC_SECRET, code(current), now, 0)).toBe(current);
    expect(verifyTotp(RFC_SECRET, code(current - 1), now, 0)).toBe(current - 1);
    expect(verifyTotp(RFC_SECRET, code(current + 1), now, 0)).toBe(current + 1);
    expect(verifyTotp(RFC_SECRET, code(current - 2), now, 0)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code(current + 2), now, 0)).toBeNull();
    // A code that already opened once does not open again.
    expect(verifyTotp(RFC_SECRET, code(current), now, current)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now, 0)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', now, 0)).toBeNull();
  });

  it('builds the address that an authenticator app reads', () => {
    const uri = otpauthUri(RFC_SECRET, 'abogada');
    expect(uri).toBe(`otpauth://totp/LexSearch:abogada?secret=${RFC_SECRET}&issuer=LexSearch&algorithm=SHA1&digits=6&period=30`);
  });
});

describe('login with a second factor', () => {
  const PASSWORD = 'una clave bien larga 123';
  const setup = async () => {
    const now = { value: 1_700_000_000_000 };
    const service = new AuthService(
      { username: 'abogada', passwordHash: await hashPassword(PASSWORD), totpSecret: RFC_SECRET, idleHours: 1, secureCookie: true },
      () => now.value,
    );
    const code = (offset = 0) => totpAt(RFC_KEY, stepAt(now.value) + offset);
    return { service, now, code };
  };

  it('needs the three right: user, password and code, and says the same when any of them fails', async () => {
    const { service, code } = await setup();
    const fail = (user: string, password: string, c: string) => service.login(user, password, c, '198.51.100.1').catch((e: Error) => e.message);
    const message = await fail('abogada', PASSWORD, '000000');
    expect(message).toBe('Usuario, contraseña o código incorrectos.');
    expect(await fail('abogada', PASSWORD, '')).toBe(message);
    expect(await fail('abogada', 'incorrecta incorrecta', code())).toBe(message);
    expect(await fail('otra', PASSWORD, code())).toBe(message);
    expect((await service.login('abogada', PASSWORD, code(), '198.51.100.1')).token).toBeTruthy();
  });

  it('does not let a code open twice, even with the right password', async () => {
    const { service, code } = await setup();
    const used = code();
    await service.login('abogada', PASSWORD, used, '198.51.100.1');
    await expect(service.login('abogada', PASSWORD, used, '198.51.100.1')).rejects.toThrow(/incorrectos/);
    // The next one, a step later, does.
    expect((await service.login('abogada', PASSWORD, code(1), '198.51.100.1')).token).toBeTruthy();
  });

  it('does not use up a code when the password was wrong', async () => {
    const { service, code } = await setup();
    await expect(service.login('abogada', 'incorrecta incorrecta', code(), '198.51.100.1')).rejects.toThrow();
    expect((await service.login('abogada', PASSWORD, code(), '198.51.100.1')).token).toBeTruthy();
  });

  it('tells the lawyer about the failed attempts since the last time she logged in', async () => {
    const { service, now, code } = await setup();
    const first = await service.login('abogada', PASSWORD, code(), '203.0.113.5');
    expect(first.security).toEqual({ failedAttempts: 0, lastFailedAt: null, lastFailedIp: null, previousLoginAt: null });

    now.value += 60_000;
    await service.login('abogada', 'x'.repeat(14), '000000', '198.51.100.77').catch(() => undefined);
    now.value += 60_000;
    service.recordBlocked('198.51.100.77');
    now.value += 60_000;
    const second = await service.login('abogada', PASSWORD, code(1), '203.0.113.5');
    expect(second.security).toMatchObject({ failedAttempts: 2, lastFailedIp: '198.51.100.77', previousLoginAt: 1_700_000_000_000 });

    // Once she knows, the next login starts from zero.
    now.value += 60_000;
    expect((await service.login('abogada', PASSWORD, code(), '203.0.113.5')).security.failedAttempts).toBe(0);
    expect(service.recentEvents(2).map((event) => event.kind)).toEqual(['LOGIN_OK', 'LOGIN_OK']);
  });
});

describe('authProblems with the second factor', () => {
  const HASH = 'scrypt:32768:8:1:pPFqhA2pI9FsFzSdWx17hA:ESNZRhJX7J9kqyyh8YpxGiCxQmdXmRG-8TFUg8oHYt8';
  it('asks for it in production, and refuses a secret that is not one', () => {
    expect(authProblems({ NODE_ENV: 'production', AUTH_USERNAME: 'a', AUTH_PASSWORD_HASH: HASH, AUTH_TOTP_SECRET: undefined })).toEqual([expect.stringMatching(/segundo factor/)]);
    expect(authProblems({ NODE_ENV: 'production', AUTH_USERNAME: 'a', AUTH_PASSWORD_HASH: HASH, AUTH_TOTP_SECRET: RFC_SECRET })).toEqual([]);
    expect(authProblems({ NODE_ENV: 'development', AUTH_USERNAME: 'a', AUTH_PASSWORD_HASH: HASH, AUTH_TOTP_SECRET: undefined })).toEqual([]);
    expect(authProblems({ NODE_ENV: 'development', AUTH_USERNAME: 'a', AUTH_PASSWORD_HASH: HASH, AUTH_TOTP_SECRET: 'corta' })).toEqual([expect.stringMatching(/no es una clave válida/)]);
    expect(authProblems({ NODE_ENV: 'development', AUTH_USERNAME: undefined, AUTH_PASSWORD_HASH: undefined, AUTH_TOTP_SECRET: RFC_SECRET })).toEqual([expect.stringMatching(/necesita usuario/)]);
  });
});
