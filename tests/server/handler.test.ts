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
