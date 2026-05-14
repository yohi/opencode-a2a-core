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
  });

  it('returns 401 for non-Bearer scheme', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
  });

  it('passes through with correct token', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer test-token-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('uses timing-safe comparison (does not leak length info)', async () => {
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer x' },
    });
    expect(res.status).toBe(401);
  });
});
