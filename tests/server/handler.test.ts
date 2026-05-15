import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createRpcHandler } from '../../src/server/rpc/handler.js';
import { JSON_RPC_ERRORS } from '../../src/server/rpc/schema.js';
import { InMemoryTaskStore } from '../../src/core/task-store.js';
import { PluginRegistry } from '../../src/core/registry.js';
import { TaskRunner } from '../../src/core/task-runner.js';
import {
  silentLogger,
  createTestPlugin,
  mkMessage,
} from './_helpers.js';

function setupApp() {
  const taskStore = new InMemoryTaskStore();
  const registry = new PluginRegistry();
  const logger = silentLogger();
  const plugin = createTestPlugin('test', async function* () {
    yield {
      kind: 'status-update',
      status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
    };
  });
  registry.register(plugin);
  const taskRunner = new TaskRunner(registry, taskStore, {
    maxAttempts: 1,
    initialBackoffMs: 10,
    maxBackoffMs: 100,
    backoffMultiplier: 2,
    jitterRatio: 0,
    logger,
  });

  const app = new Hono();
  const deps = {
    taskStore,
    registry,
    taskRunner,
    pluginId: 'test',
    activeAbortControllers: new Map<string, AbortController>(),
    logger,
  };
  app.post('/', createRpcHandler(deps));
  return { app, deps };
}

describe('RPC Handler validation', () => {
  it('returns PARSE_ERROR for invalid JSON', async () => {
    const { app } = setupApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });
    const body = await res.json() as { error: { code: number }; id?: unknown };
    expect(body.error.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR);
  });

  it('returns INVALID_REQUEST for wrong jsonrpc version', async () => {
    const { app } = setupApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'test' }),
    });
    const body = await res.json() as { error: { code: number } };
    expect(body.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
  });

  it('returns INVALID_REQUEST for notification (missing id)', async () => {
    const { app } = setupApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'message/send' }),
    });
    const body = await res.json() as { error: { code: number }; id: unknown };
    expect(body.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
    expect(body.id).toBeNull();
  });

  it('returns METHOD_NOT_FOUND for unknown method', async () => {
    const { app } = setupApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unknown' }),
    });
    const body = await res.json() as { error: { code: number } };
    expect(body.error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
  });

  it('returns INVALID_PARAMS for bad message/send params', async () => {
    const { app } = setupApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: {} }),
    });
    const body = await res.json() as { error: { code: number } };
    expect(body.error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
  });
});

describe('tasks/get handler', () => {
  it('returns TASK_NOT_FOUND for nonexistent task', async () => {
    const { app } = setupApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tasks/get',
        params: { taskId: 'nonexistent' },
      }),
    });
    const body = await res.json() as { error: { code: number } };
    expect(body.error.code).toBe(JSON_RPC_ERRORS.TASK_NOT_FOUND);
  });
});

describe('Integration flows', () => {
  it('message/stream exercises full SSE flow', async () => {
    const { app, deps } = setupApp();
    const plugin = createTestPlugin('test-stream', async function* () {
      yield { kind: 'message', message: { role: 'ROLE_AGENT', parts: [{ kind: 'text', text: 'part 1' }] } };
      yield { kind: 'message', message: { role: 'ROLE_AGENT', parts: [{ kind: 'text', text: 'part 2' }] } };
    });
    deps.registry.register(plugin);
    deps.pluginId = 'test-stream';

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/stream',
        params: { message: mkMessage() },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('event: task');
    expect(text).toContain('event: message');
    expect(text).toContain('part 1');
    expect(text).toContain('part 2');
    expect(text).toContain('TASK_STATE_COMPLETED');
  });

  it('tasks/cancel cancels a long-running task', async () => {
    const { app, deps } = setupApp();
    let aborted = false;
    const plugin = createTestPlugin('test-cancel', async function* (_msg, { abortSignal }) {
      yield* [];
      await new Promise((resolve, reject) => {
        if (abortSignal.aborted) {
          aborted = true;
          return reject(new Error('Aborted'));
        }
        abortSignal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('Aborted'));
        });
      });
    });
    deps.registry.register(plugin);
    deps.pluginId = 'test-cancel';

    const resPromise = app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/stream',
        params: { message: mkMessage() },
      }),
    });

    const res = await resPromise;
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No reader');
    
    // Read chunks until we find taskId and state is WORKING
    let taskId = '';
    let buffer = '';
    const decoder = new TextDecoder();
    
    outer: while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';

      for (const frame of frames) {
        if (!taskId && frame.includes('event: task')) {
          const dataMatch = frame.match(/data:\s*({.+})/);
          if (dataMatch) {
            const data = JSON.parse(dataMatch[1]);
            taskId = data.task.id;
          }
        }
        if (frame.includes('TASK_STATE_WORKING')) break outer;
      }
    }

    if (!taskId) throw new Error('Could not find taskId');

    // Background read to avoid backpressure
    const readRest = async () => {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    };
    const restPromise = readRest();

    const cancelRes = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/cancel',
        params: { taskId },
      }),
    });

    type RpcResponse = { error: { code: number; message: string } } | { result: { status: { state: string } } };
    const body = (await cancelRes.json()) as RpcResponse;
    if ('error' in body) {
      throw new Error(`RPC Error: ${JSON.stringify(body.error)}`);
    }
    expect(['TASK_STATE_CANCELED', 'TASK_STATE_FAILED']).toContain(body.result.status.state);
    for (let i = 0; i < 50; i++) {
      if (aborted) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(aborted).toBe(true);
    await restPromise;
    reader.releaseLock();
  }, 10000);
  it.each([
    'TASK_STATE_COMPLETED',
    'TASK_STATE_FAILED',
    'TASK_STATE_CANCELED',
  ] as const)('tasks/cancel returns TASK_NOT_CANCELABLE error for already %s task', async (state) => {
    const { app, deps } = setupApp();

    const task = await deps.taskStore.create({});
    await deps.taskStore.updateStatus(task.id, {
      state,
      timestamp: new Date().toISOString(),
    });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/cancel',
        params: { taskId: task.id },
      }),
    });

    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32003);
    expect(body.error.message).toContain(`(${state})`);
  });

});
