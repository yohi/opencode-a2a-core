import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bearerAuth } from '../../src/server/middleware/auth.js';

function createApp(token: string) {
  const app = new Hono();
  app.use('*', bearerAuth(token));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('bearerAuth middleware', () => {
  const app = createApp('test-token-123');

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/test');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 401 for invalid token', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 401 for non-Bearer scheme', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('passes through with correct token', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer test-token-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('is case-insensitive for Bearer scheme', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'bearer test-token-123' },
    });
    expect(res.status).toBe(200);
  });

  it.each([
    { name: 'empty token', token: '' },
    { name: 'shorter token', token: 'x' },
    { name: 'same-length mismatched token', token: 'test-token-999' },
    { name: 'longer token', token: 'test-token-123-extra' },
  ])('rejects $name with 401', async ({ token }) => {
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('throws error when initialized with empty token', () => {
    expect(() => bearerAuth('')).toThrow('bearerAuth: expectedToken must be a non-empty string');
    expect(() => bearerAuth('   ')).toThrow('bearerAuth: expectedToken must be a non-empty string');
  });
});
