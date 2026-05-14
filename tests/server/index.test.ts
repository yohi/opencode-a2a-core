import { describe, it, expect, vi } from 'vitest';
import { createA2AServer } from '../../src/server/index.js';
import { createTestPlugin, mkMessage, silentLogger } from './_helpers.js';

describe('createA2AServer', () => {
  const plugin = createTestPlugin('echo', async function* () {
    yield {
      kind: 'status-update',
      status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
    };
  });

  it('throws when auth is not configured and allowUnauthenticated is not set', () => {
    expect(() => createA2AServer({ plugin })).toThrow();
  });

  it('creates app with allowUnauthenticated: true (warns)', () => {
    const logger = silentLogger();
    const warnSpy = vi.spyOn(logger, 'warn');
    const app = createA2AServer({
      plugin,
      allowUnauthenticated: true,
      logger,
    });
    expect(app).toBeDefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('creates app with auth token', () => {
    const app = createA2AServer({
      plugin,
      auth: { token: 'secret' },
    });
    expect(app).toBeDefined();
  });
});

describe('AgentCard endpoint', () => {
  const plugin = createTestPlugin('echo', async function* () {
    yield {
      kind: 'status-update',
      status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
    };
  });

  it('returns agent card JSON on GET /.well-known/agent.json', async () => {
    const app = createA2AServer({
      plugin,
      allowUnauthenticated: true,
    });
    const res = await app.request('/.well-known/agent.json');
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; capabilities: { streaming: boolean }; skills: unknown[] };
    expect(body.name).toBe('echo');
    expect(body.capabilities).toEqual({ streaming: true });
    expect(body.skills).toHaveLength(1);
  });

  it('uses baseUrl when provided', async () => {
    const app = createA2AServer({
      plugin,
      allowUnauthenticated: true,
      baseUrl: 'https://example.com',
    });
    const res = await app.request('/.well-known/agent.json');
    const body = await res.json() as { url: string };
    expect(body.url).toBe('https://example.com');
  });

  it('ignores X-Forwarded headers when trustProxy is false (default)', async () => {
    const app = createA2AServer({
      plugin,
      allowUnauthenticated: true,
    });
    const res = await app.request('/.well-known/agent.json', {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'proxy.example.com, internal.local',
      },
    });
    const body = await res.json() as { url: string };
    expect(body.url).toBe('http://localhost');
  });

  it('uses X-Forwarded headers when trustProxy is true', async () => {
    const app = createA2AServer({
      plugin,
      allowUnauthenticated: true,
      trustProxy: true,
    });
    const res = await app.request('/.well-known/agent.json', {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'proxy.example.com, internal.local',
      },
    });
    const body = await res.json() as { url: string };
    expect(body.url).toBe('https://proxy.example.com');
  });

  it('falls back to request.url origin when proxy headers are invalid or partial', async () => {
    const app = createA2AServer({
      plugin,
      allowUnauthenticated: true,
      trustProxy: true,
    });

    // Partial header
    const res1 = await app.request('/.well-known/agent.json', {
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    expect((await res1.json() as { url: string }).url).toBe('http://localhost');

    // Invalid scheme
    const res2 = await app.request('/.well-known/agent.json', {
      headers: {
        'X-Forwarded-Proto': 'ftp',
        'X-Forwarded-Host': 'example.com',
      },
    });
    expect((await res2.json() as { url: string }).url).toBe('http://localhost');
  });

  it('falls back to request.url origin', async () => {
    const app = createA2AServer({
      plugin,
      allowUnauthenticated: true,
    });
    const res = await app.request('/.well-known/agent.json');
    const body = await res.json() as { url: string };
    expect(body.url).toBe('http://localhost');
  });
});

describe('Auth integration', () => {
  const plugin = createTestPlugin('echo', async function* () {
    yield {
      kind: 'status-update',
      status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
    };
  });

  it('rejects unauthenticated RPC requests', async () => {
    const app = createA2AServer({ plugin, auth: { token: 'secret' } });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tasks/get',
        params: { taskId: 'x' },
      }),
    });
    expect(res.status).toBe(401);
  });

  it('allows authenticated RPC requests', async () => {
    const app = createA2AServer({ plugin, auth: { token: 'secret' } });
    const res = await app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tasks/get',
        params: { taskId: 'nonexistent' },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { error: { code: number } };
    expect(body.error.code).toBe(-32001); // TASK_NOT_FOUND
  });

  it('AgentCard does not require auth', async () => {
    const app = createA2AServer({ plugin, auth: { token: 'secret' } });
    const res = await app.request('/.well-known/agent.json');
    expect(res.status).toBe(200);
  });
});

describe('message/send E2E', () => {
  it('returns completed task', async () => {
    const plugin = createTestPlugin('e2e', async function* () {
      yield {
        kind: 'status-update',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
      };
    });
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: { message: mkMessage() },
      }),
    });
    const body = await res.json() as { result: { status: { state: string } } };
    expect(body.result).toBeDefined();
    expect(body.result.status.state).toBe('TASK_STATE_COMPLETED');
  });
});
