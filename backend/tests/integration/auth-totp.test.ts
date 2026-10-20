import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/password.js';
import { stepAt, totpAt } from '../../src/modules/auth/totp.js';
import { createTestApp } from '../helpers/test-app.js';

const PASSWORD = 'una clave bien larga 123';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const KEY = Buffer.from('12345678901234567890');

// A clock that the tests move: a code opens once, so each login needs a later step.
const clock = { value: new Date('2026-10-20T15:00:00Z').getTime() };
const ctx = await createTestApp({
  auth: { username: 'abogada', passwordHash: await hashPassword(PASSWORD), totpSecret: SECRET, idleHours: 12, secureCookie: false },
  now: () => new Date(clock.value),
});
afterAll(() => ctx.close());

const code = (offset = 0) => totpAt(KEY, stepAt(clock.value) + offset);
const login = (body: object) => request(ctx.app).post('/api/auth/login').send({ username: 'abogada', password: PASSWORD, ...body });

describe('login with a second factor', () => {
  it('says that a code is needed, so the screen asks for it', async () => {
    expect((await request(ctx.app).get('/api/auth/me')).body).toMatchObject({ authRequired: true, totpRequired: true, authenticated: false });
  });

  it('does not let in with the password alone or with a wrong code, and answers the same', async () => {
    const noCode = await login({});
    const wrongCode = await login({ code: '000000' });
    expect(noCode.status).toBe(401);
    expect(wrongCode.body).toEqual(noCode.body);
    expect(noCode.body.error.message).toBe('Usuario, contraseña o código incorrectos.');
    expect(noCode.headers['set-cookie']).toBeUndefined();
  });

  it('lets in with the right code, once, and then tells about the failed attempts there were', async () => {
    const ok = await login({ code: code() });
    expect(ok.status).toBe(200);
    // The two attempts of the test above (no code, wrong code) were before the first login that worked.
    expect(ok.body.security).toMatchObject({ failedAttempts: 2 });
    // The same code does not open a second time.
    expect((await login({ code: code() })).status).toBe(401);

    const next = await login({ code: code(1) });
    expect(next.status).toBe(200);
    // Only the repeated code failed since the previous login that worked.
    expect(next.body.security.failedAttempts).toBe(1);
    expect(next.body.security.lastFailedIp).toEqual(expect.any(String));
  });

  it('shows the recent access events only to whoever is logged in', async () => {
    expect((await request(ctx.app).get('/api/auth/activity')).status).toBe(401);
    clock.value += 120_000;
    const session = (await login({ code: code() })).headers['set-cookie'] as unknown as string[];
    const activity = await request(ctx.app).get('/api/auth/activity').set('Cookie', session[0]!.split(';')[0]!);
    expect(activity.status).toBe(200);
    expect(activity.body.events[0]).toMatchObject({ kind: 'LOGIN_OK', ip: expect.any(String) });
    expect(activity.body.events.some((event: { kind: string }) => event.kind === 'LOGIN_FAILED')).toBe(true);
  });
});

describe('requests from another site', () => {
  it('refuses what changes things when it comes from another origin, and accepts its own', async () => {
    const hostile = await request(ctx.app).post('/api/auth/logout').set('Origin', 'https://sitio-malicioso.example');
    expect(hostile.status).toBe(403);
    expect(hostile.body.error.code).toBe('FORBIDDEN');
    expect((await request(ctx.app).post('/api/auth/logout').set('Origin', 'null')).status).toBe(403);
    expect((await request(ctx.app).post('/api/auth/logout').set('Origin', 'http://localhost:5180')).status).toBe(204);
    // Reading is not blocked (the cookie is SameSite=Strict, and the answer is not readable from another site).
    expect((await request(ctx.app).get('/api/auth/me').set('Origin', 'https://sitio-malicioso.example')).status).toBe(200);
    // No Origin: not a browser (curl, the CI).
    expect((await request(ctx.app).post('/api/auth/logout')).status).toBe(204);
  });
});
