import { describe, expect, it } from 'vitest';
import { authProblems } from '../../src/config/env.js';
import { AuthService, readCookie } from '../../src/modules/auth/auth.service.js';
import { hashPassword, parseHash, verifyPassword } from '../../src/modules/auth/password.js';

const login = async (service: AuthService, user = 'abogada', password = 'una clave bien larga 123') => (await service.login(user, password, '', '203.0.113.5')).token;

const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const VALID_HASH = 'scrypt:32768:8:1:pPFqhA2pI9FsFzSdWx17hA:ESNZRhJX7J9kqyyh8YpxGiCxQmdXmRG-8TFUg8oHYt8';

describe('passwords', () => {
  it('hashes with a salt and verifies only the right password', async () => {
    const a = await hashPassword('una clave bien larga 123');
    const b = await hashPassword('una clave bien larga 123');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt:\d+:8:1:[\w-]+:[\w-]+$/);
    expect(a).not.toMatch(/[$'"\s]/);
    expect(await verifyPassword('una clave bien larga 123', a)).toBe(true);
    expect(await verifyPassword('otra clave distinta 456', a)).toBe(false);
  });

  it('refuses a hash that is not one, and a cost that would exhaust the memory', async () => {
    expect(parseHash('texto cualquiera')).toBeNull();
    expect(parseHash(`scrypt:2147483648:8:1:abcdefgh:${'a'.repeat(43)}`)).toBeNull();
    expect(await verifyPassword('x', 'scrypt:1:2:3')).toBe(false);
  });
});

describe('sessions', () => {
  const setup = async () => {
    const now = { value: 1_000_000 };
    const service = new AuthService(
      { username: 'abogada', passwordHash: await hashPassword('una clave bien larga 123'), idleHours: 1, secureCookie: true },
      () => now.value,
    );
    return { service, now };
  };

  it('opens a session with the right user and password and closes it on logout', async () => {
    const { service } = await setup();
    const token = await login(service);
    expect(service.check(token)).toBe(true);
    service.logout(token);
    expect(service.check(token)).toBe(false);
  });

  it('gives the same error for a wrong user and a wrong password', async () => {
    const { service } = await setup();
    const wrongUser = await login(service, 'otra').catch((e: Error) => e.message);
    const wrongPassword = await login(service, 'abogada', 'incorrecta incorrecta').catch((e: Error) => e.message);
    expect(wrongUser).toBe(wrongPassword);
    expect(wrongUser).toMatch(/incorrectos/);
  });

  it('expires after the idle time, and using it extends it', async () => {
    const { service, now } = await setup();
    const token = await login(service);
    now.value += 50 * 60_000;
    expect(service.check(token)).toBe(true);
    now.value += 50 * 60_000;
    expect(service.check(token)).toBe(true);
    now.value += 61 * 60_000;
    expect(service.check(token)).toBe(false);
  });

  it('never lasts more than a week, however much it is used', async () => {
    const { service, now } = await setup();
    const token = await login(service);
    // Used every 50 minutes, it would never expire by being idle.
    for (let elapsed = 0; elapsed < 7 * 24 * 60 - 60; elapsed += 50) {
      now.value += 50 * 60_000;
      expect(service.check(token)).toBe(true);
    }
    now.value += 2 * 60 * 60_000;
    expect(service.check(token)).toBe(false);
  });

  it('does not accept a made up token', async () => {
    const { service } = await setup();
    expect(service.check('inventado')).toBe(false);
    expect(service.check(undefined)).toBe(false);
  });
});

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('a=1; lexsearch_session=abc.def; b=2', 'lexsearch_session')).toBe('abc.def');
    expect(readCookie(undefined, 'x')).toBeUndefined();
  });
});

describe('authProblems', () => {
  it('needs both settings together, and in production it needs them', () => {
    expect(authProblems({ NODE_ENV: 'development', AUTH_USERNAME: undefined, AUTH_PASSWORD_HASH: undefined, AUTH_TOTP_SECRET: undefined })).toEqual([]);
    expect(authProblems({ NODE_ENV: 'development', AUTH_USERNAME: 'a', AUTH_PASSWORD_HASH: undefined, AUTH_TOTP_SECRET: undefined })).toHaveLength(1);
    expect(authProblems({ NODE_ENV: 'production', AUTH_USERNAME: undefined, AUTH_PASSWORD_HASH: undefined, AUTH_TOTP_SECRET: undefined })).toHaveLength(1);
    expect(authProblems({ NODE_ENV: 'production', AUTH_USERNAME: 'a', AUTH_PASSWORD_HASH: VALID_HASH, AUTH_TOTP_SECRET: TOTP_SECRET })).toEqual([]);
  });

  it('refuses a hash that is not one, instead of letting every login fail with no explanation', () => {
    expect(authProblems({ NODE_ENV: 'development', AUTH_USERNAME: 'a', AUTH_PASSWORD_HASH: 'cualquier cosa', AUTH_TOTP_SECRET: undefined })).toEqual([expect.stringMatching(/formato esperado/)]);
  });
});
