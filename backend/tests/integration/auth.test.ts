import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createTestApp } from '../helpers/test-app.js';

const PASSWORD = 'una clave bien larga 123';
const ctx = await createTestApp({
  auth: { username: 'abogada', passwordHash: await hashPassword(PASSWORD), idleHours: 12, secureCookie: false },
  loginAttempts: 3,
});
const open = await createTestApp();
afterAll(async () => {
  await ctx.close();
  await open.close();
});

const login = (password = PASSWORD, username = 'abogada') => request(ctx.app).post('/api/auth/login').send({ username, password });
const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;

describe('with a password set', () => {
  it('keeps everything behind the login, but the health check and the login itself', async () => {
    expect((await request(ctx.app).get('/api/documents')).status).toBe(401);
    expect((await request(ctx.app).get('/api/clients')).status).toBe(401);
    expect((await request(ctx.app).get('/api/openapi.json')).status).toBe(401);
    expect((await request(ctx.app).get('/api/docs/')).status).toBe(401);
    expect((await request(ctx.app).get('/api/health')).status).toBe(200);
    const me = await request(ctx.app).get('/api/auth/me');
    expect(me.body).toEqual({ authRequired: true, authenticated: false, username: null });
  });

  it('logs in, sets a cookie that a page can not read, and lets the lawyer in', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authRequired: true, authenticated: true, username: 'abogada' });
    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).not.toContain(PASSWORD);

    const cookie = cookieOf(res);
    expect((await request(ctx.app).get('/api/documents').set('Cookie', cookie)).status).toBe(200);
    expect((await request(ctx.app).get('/api/openapi.json').set('Cookie', cookie)).status).toBe(200);
    expect((await request(ctx.app).get('/api/auth/me').set('Cookie', cookie)).body.authenticated).toBe(true);
  });

  it('closes the session on logout', async () => {
    const cookie = cookieOf(await login());
    expect((await request(ctx.app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await request(ctx.app).get('/api/documents').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects a made up cookie', async () => {
    expect((await request(ctx.app).get('/api/documents').set('Cookie', 'lexsearch_session=inventada')).status).toBe(401);
  });

  it('validates the input, then stops guessing after three failed attempts', async () => {
    expect((await request(ctx.app).post('/api/auth/login').send({ username: 'abogada' })).status).toBe(400);

    const wrongPassword = await login('incorrecta incorrecta');
    const wrongUser = await login(PASSWORD, 'otra');
    expect(wrongPassword.status).toBe(401);
    expect(wrongUser.body).toEqual(wrongPassword.body);
    expect(wrongPassword.body.error.message).toBe('Usuario o contraseña incorrectos.');
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();

    // The previous failures (this test and the ones before) used up the window: the next one is blocked.
    await login('otra incorrecta');
    const blocked = await login('y otra más incorrecta');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMIT');
  });
});

describe('behind the proxies of Docker', () => {
  it('limits the failed attempts of each address, so one person can not lock the lawyer out', async () => {
    const proxied = await createTestApp({
      auth: { username: 'abogada', passwordHash: await hashPassword(PASSWORD), idleHours: 12, secureCookie: false },
      loginAttempts: 2,
      trustProxyHops: 1,
    });
    try {
      const from = (ip: string, password: string) =>
        request(proxied.app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ username: 'abogada', password });

      expect((await from('203.0.113.9', 'incorrecta uno')).status).toBe(401);
      expect((await from('203.0.113.9', 'incorrecta dos')).status).toBe(401);
      expect((await from('203.0.113.9', 'incorrecta tres')).status).toBe(429);
      // Somebody else, from another address, is not affected.
      expect((await from('198.51.100.7', PASSWORD)).status).toBe(200);
    } finally {
      await proxied.close();
    }
  });
});

describe('without a password set (development)', () => {
  it('leaves the system open, as before', async () => {
    expect((await request(open.app).get('/api/documents')).status).toBe(200);
    expect((await request(open.app).get('/api/auth/me')).body).toEqual({ authRequired: false, authenticated: true, username: null });
  });
});
