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
    expect(body.name).toBe('echo'); // Uses plugin.name
    expect(body.capabilities).toEqual({ streaming: true });
    expect(body.skills).toHaveLength(1);
  });

  it('allows overriding streaming capability', async () => {
    const nonStreamingPlugin = {
      ...plugin,
      metadata: () => ({
        skills: [],
        capabilities: { streaming: false },
      }),
    };
    const app = createA2AServer({
      plugin: nonStreamingPlugin,
      allowUnauthenticated: true,
    });
    const res = await app.request('/.well-known/agent.json');
    const body = await res.json() as { capabilities: { streaming: boolean } };
    expect(body.capabilities.streaming).toBe(false);
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

    // Malicious host with path or userinfo
    const res3 = await app.request('/.well-known/agent.json', {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'evil.com/injected',
      },
    });
    expect((await res3.json() as { url: string }).url).toBe('http://localhost');

    const res4 = await app.request('/.well-known/agent.json', {
      headers: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'user@evil.com',
      },
    });
    expect((await res4.json() as { url: string }).url).toBe('http://localhost');
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

  it('allows authenticated RPC requests with trimmed token even if configured with whitespace', async () => {
    const app = createA2AServer({ plugin, auth: { token: '  secret-with-whitespace  ' } });
    const res = await app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-with-whitespace',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tasks/get',
        params: { taskId: 'nonexistent' },
      }),
    });
    expect(res.status).toBe(200);
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

describe('message/stream E2E', () => {
  it('streams SSE events with correct Content-Type', async () => {
    const plugin = createTestPlugin('stream-test', async function* () {
      yield { kind: 'message', message: mkMessage('reply') };
    });
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/stream',
        params: { message: mkMessage() },
      }),
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('returns INVALID_REQUEST for notification in message/stream', async () => {
    const plugin = createTestPlugin('stream-notif', async function* () {});
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'message/stream', params: { message: mkMessage() } }),
    });
    const body = await res.json() as { error: { code: number } };
    expect(body.error.code).toBe(-32600);
  });

  it('sends error event when plugin throws before first chunk (taskId not acquired)', async () => {
    const plugin = createTestPlugin('fail-early-stream', async function* () {
      throw new Error('init failure');
    });
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/stream',
        params: { message: mkMessage() },
      }),
    });
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain('"code":-32603'); // INTERNAL_ERROR
  });
});

describe('tasks/cancel E2E', () => {
  it('returns TASK_NOT_FOUND for nonexistent task', async () => {
    const plugin = createTestPlugin('cancel-test', async function* () {});
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tasks/cancel',
        params: { taskId: 'nonexistent' },
      }),
    });
    const body = await res.json() as { error: { code: number } };
    expect(body.error.code).toBe(-32001);
  });
});

describe('message/send error handling', () => {
  it('returns TASK_STATE_FAILED when plugin throws before first chunk', async () => {
    const plugin = createTestPlugin('fail-early', async function* () {
      throw new Error('init failure');
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
    const body = await res.json() as { result?: { status: { state: string } } };
    // Task is created before plugin executes, so we get the failed task back
    expect(body.result).toBeDefined();
    expect(body.result!.status.state).toBe('TASK_STATE_FAILED');
  });

  it('cleans up activeAbortControllers after completion', async () => {
    const plugin = createTestPlugin('cleanup', async function* () {
      yield {
        kind: 'status-update',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
      };
    });
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: { message: mkMessage() },
      }),
    });
    // If we can send another request successfully, controllers were cleaned up
    const res2 = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'message/send',
        params: { message: mkMessage() },
      }),
    });
    const body2 = await res2.json() as { result: unknown };
    expect(body2.result).toBeDefined();
  });
});

describe('edge cases and race conditions', () => {
  // Hono in-memory requests don't reject on AbortSignal,
  // so these tests verify that requests complete without crashing
  it('message/send handles aborted signal gracefully', async () => {
    const plugin = createTestPlugin('disconnect-send', async function* () {
      await new Promise((r) => setTimeout(r, 100)); // Simulate delay
    });
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const abortController = new AbortController();
    const reqPromise = app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: mkMessage() } }),
      signal: abortController.signal,
    });

    abortController.abort(); // Disconnect immediately
    // Request should complete without crashing
    const res = await reqPromise;
    expect(res.status).toBe(200);
  });

  it('message/stream handles aborted signal gracefully', async () => {
    const plugin = createTestPlugin('disconnect-stream', async function* () {
      await new Promise((r) => setTimeout(r, 100)); // Simulate delay
    });
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const abortController = new AbortController();
    const reqPromise = app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/stream', params: { message: mkMessage() } }),
      signal: abortController.signal,
    });

    abortController.abort();
    const res = await reqPromise;
    expect(res.status).toBe(200);
  });

  it('message/send handles already-aborted signal gracefully', async () => {
    const plugin = createTestPlugin('already-aborted-send', async function* () {});
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const abortController = new AbortController();
    abortController.abort();

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: mkMessage() } }),
      signal: abortController.signal,
    });
    expect(res.status).toBe(200);
  });

  it('message/stream handles already-aborted signal gracefully', async () => {
    const plugin = createTestPlugin('already-aborted-stream', async function* () {});
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const abortController = new AbortController();
    abortController.abort();

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/stream', params: { message: mkMessage() } }),
      signal: abortController.signal,
    });
    expect(res.status).toBe(200);
  });

  it('tasks/cancel returns error for already terminal task', async () => {
    const plugin = createTestPlugin('cancel-already-terminal', async function* () {
      yield {
        kind: 'status-update',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
      };
    });
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    const resSend = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: mkMessage() } }),
    });
    const bodySend = await resSend.json() as { result: { id: string } };
    const taskId = bodySend.result.id;

    const resCancel = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tasks/cancel', params: { taskId } }),
    });
    const bodyCancel = await resCancel.json() as { error: { code: number } };
    expect(bodyCancel.error.code).toBe(-32004); // TASK_ALREADY_COMPLETED
  });

  it('tasks/cancel returns COMPLETED task if it completes during cancellation race', async () => {
    let completeTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      completeTask = resolve;
    });

    const plugin = createTestPlugin('cancel-race', async function* () {
      // The TaskRunner emits its own WORKING status-update before calling execute(),
      // so the first plugin yield is a second WORKING update (then block).
      yield {
        kind: 'status-update',
        status: { state: 'TASK_STATE_WORKING', timestamp: new Date().toISOString() } as any,
      };
      await taskPromise;
      yield {
        kind: 'status-update',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() } as any,
      };
    });
    const app = createA2AServer({ plugin, allowUnauthenticated: true });

    // Use message/stream — get a streaming response, then read the first SSE event
    // to extract the taskId without waiting for the full stream to complete.
    const streamRes = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/stream', params: { message: mkMessage() } }),
    });

    let taskId = '';
    // Read from the SSE stream to get the task event
    if (streamRes.body) {
      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE event contains "data: {JSON}\n\n"
        if (buffer.includes('\n\n')) {
          const events = buffer.split('\n\n');
          for (const event of events) {
            const dataLine = event.split('\n').find((l) => l.startsWith('data: '));
            if (dataLine) {
              try {
                const data = JSON.parse(dataLine.slice(6));
                if (data.task && data.task.id) {
                  taskId = data.task.id;
                  break;
                }
              } catch {
                // Ignore partial JSON
              }
            }
          }
        }
        if (taskId) break;
      }
      // Cancel the reader to close the stream (we don't need the full SSE body)
      reader.cancel();
    }
    expect(taskId).toBeTruthy();

    // Send cancel request, but do not await yet
    const cancelReqPromise = app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tasks/cancel', params: { taskId: taskId } }),
    });

    // Simulate task completing just as cancel is processing
    completeTask!();

    const resCancel = await cancelReqPromise;
    const bodyCancel = await resCancel.json() as any;

    // The result should be the successfully completed task
    // or if cancel won the race, the canceled task
    if (bodyCancel.result) {
      expect(bodyCancel.result.status.state).toMatch(/COMPLETED|CANCELED/);
    } else if (bodyCancel.error) {
      // Cancel might have completed first, or task might have already finished
      expect([-32002, -32004]).toContain(bodyCancel.error.code);
    } else {
      throw new Error(`Unexpected response format: ${JSON.stringify(bodyCancel)}`);
    }
  }, 15000);
});
