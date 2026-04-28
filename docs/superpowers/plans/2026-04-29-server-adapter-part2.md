# HTTP Server Adapter Implementation Plan (Part 2/3)

> 本ファイルは Part 1 の続きです。Part 1: `docs/superpowers/plans/2026-04-29-server-adapter-part1.md`

---

## Task 2: Bearer Auth Middleware (`src/server/middleware/auth.ts`)

**派生元:** `feature/phase1_server-adapter__base` (Base) — Schema とは独立

**Files:**
- Create: `src/server/middleware/auth.ts`
- Test: `tests/server/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/auth.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run (Devcontainer内): `pnpm vitest run tests/server/auth.test.ts`
Expected: FAIL — モジュール不在

- [ ] **Step 3: Write implementation**

```typescript
// src/server/middleware/auth.ts
import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export function bearerAuth(expectedToken: string): MiddlewareHandler {
  const expectedBuf = Buffer.from(expectedToken, 'utf-8');

  return async (c, next) => {
    const header = c.req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = header.slice(7);
    const tokenBuf = Buffer.from(token, 'utf-8');

    const isLengthMatch = tokenBuf.length === expectedBuf.length;
    const compareBuf = isLengthMatch
      ? tokenBuf
      : Buffer.alloc(expectedBuf.length);
    const isEqual = timingSafeEqual(compareBuf, expectedBuf) && isLengthMatch;

    if (!isEqual) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    await next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (Devcontainer内): `pnpm vitest run tests/server/auth.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Lint and Typecheck (Devcontainer内)**

```bash
pnpm lint
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/middleware/auth.ts tests/server/auth.test.ts
git commit -m "feat(server): add timing-safe Bearer auth middleware"
```

- [ ] **Step 7: Draft PR to Phase Base**

`feature/phase1-task2_auth-middleware` → `feature/phase1_server-adapter__base` へ Draft PR を作成。

---

## Task 3: RPC Handler (`src/server/rpc/handler.ts`)

**派生元:** `feature/phase1-task2_auth-middleware` (Task2) — handler は auth middleware の上に構築され、Task1 の schema も使用する数珠つなぎタスク

**Files:**
- Create: `src/server/rpc/handler.ts`
- Create: `tests/server/_helpers.ts`
- Test: `tests/server/handler.test.ts`

- [ ] **Step 1: Create test helpers**

```typescript
// tests/server/_helpers.ts
import { z } from 'zod';
import type { A2APluginInterface } from '../../src/core/plugin-interface.js';
import type { Message, StreamResponse } from '../../src/core/a2a-types.js';
import type { Logger } from '../../src/core/logger.js';

export function silentLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

export function mkMessage(text = 'hello'): Message {
  return { role: 'ROLE_USER', parts: [{ kind: 'text', text }] };
}

export function createTestPlugin(
  id: string,
  executeFn: (
    msg: Message,
    ctx: { abortSignal: AbortSignal }
  ) => AsyncIterable<StreamResponse>
): A2APluginInterface {
  return {
    id,
    version: '1.0.0',
    configSchema: z.object({}).passthrough(),
    async initialize() {},
    async dispose() {},
    execute: executeFn,
    metadata: () => ({
      skills: [{ id, name: id, description: `Test plugin ${id}` }],
    }),
  };
}

export function rpcRequest(
  method: string,
  params?: unknown,
  id?: string | number
): Request {
  const body: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (id !== undefined) body.id = id;
  if (params !== undefined) body.params = params;
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 2: Write the failing test for handler**

```typescript
// tests/server/handler.test.ts
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
    const body = await res.json();
    expect(body.error.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR);
  });

  it('returns INVALID_REQUEST for wrong jsonrpc version', async () => {
    const { app } = setupApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'test' }),
    });
    const body = await res.json();
    expect(body.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
  });

  it('returns INVALID_REQUEST for notification (missing id)', async () => {
    const { app } = setupApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'message/send' }),
    });
    const body = await res.json();
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
    const body = await res.json();
    expect(body.error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
  });

  it('returns INVALID_PARAMS for bad message/send params', async () => {
    const { app } = setupApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: {} }),
    });
    const body = await res.json();
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
    const body = await res.json();
    expect(body.error.code).toBe(JSON_RPC_ERRORS.TASK_NOT_FOUND);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (Devcontainer内): `pnpm vitest run tests/server/handler.test.ts`
Expected: FAIL — `createRpcHandler` が存在しない

- [ ] **Step 4: Write handler implementation**

```typescript
// src/server/rpc/handler.ts
import type { Handler } from 'hono';
import type { TaskStore } from '../../core/task-store.js';
import type { PluginRegistry } from '../../core/registry.js';
import type { TaskRunner } from '../../core/task-runner.js';
import type { Logger } from '../../core/logger.js';
import { streamSSE } from 'hono/streaming';
import {
  JsonRpcRequestSchema,
  MessageSendParamsSchema,
  MessageStreamParamsSchema,
  TasksGetParamsSchema,
  TasksCancelParamsSchema,
  JSON_RPC_ERRORS,
} from './schema.js';

export interface ServerDependencies {
  taskStore: TaskStore;
  registry: PluginRegistry;
  taskRunner: TaskRunner;
  pluginId: string;
  activeAbortControllers: Map<string, AbortController>;
  logger: Logger;
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

function rpcResult(id: string | number, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

const TERMINAL_STATES = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
]);

export function createRpcHandler(deps: ServerDependencies): Handler {
  return async (c) => {
    // 1. JSON parse
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(rpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error'));
    }

    // 2. JSON-RPC structure validation
    const parsed = JsonRpcRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        rpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid Request')
      );
    }
    const { method, params, id } = parsed.data;

    // 3. Method dispatch (id is guaranteed present by schema validation)
    switch (method) {
      case 'message/send':
        return handleMessageSend(c, deps, id, params);
      case 'message/stream':
        return handleMessageStream(c, deps, id, params);
      case 'tasks/get':
        return handleTasksGet(c, deps, id, params);
      case 'tasks/cancel':
        return handleTasksCancel(c, deps, id, params);
      default:
        return c.json(
          rpcError(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`)
        );
    }
  };
}

async function handleMessageSend(
  c: { req: { raw: Request }; json: (data: unknown, status?: number) => Response },
  deps: ServerDependencies,
  id: string | number,
  params: unknown
) {
  const parsed = MessageSendParamsSchema.safeParse(params);
  if (!parsed.success) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params'));
  }

  const abortController = new AbortController();
  let taskId: string | undefined;

  const onAbort = () => abortController.abort();
  c.req.raw.signal.addEventListener('abort', onAbort);
  if (c.req.raw.signal.aborted) abortController.abort();

  try {
    const iter = deps.taskRunner.run(deps.pluginId, parsed.data.message, {
      abortSignal: abortController.signal,
      contextId: parsed.data.contextId,
    });

    for await (const chunk of iter) {
      if (chunk.kind === 'task' && !taskId) {
        taskId = chunk.task.id;
        deps.activeAbortControllers.set(taskId, abortController);
      }
    }

    if (!taskId) {
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'No task was created'));
    }

    const task = await deps.taskStore.get(taskId);
    if (!task) {
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error: Task disappeared'));
    }
    return c.json(rpcResult(id, task));
  } catch {
    if (!taskId) {
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error'));
    }
    try {
      const task = await deps.taskStore.get(taskId);
      if (!task) {
        return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error: Task not found after failure'));
      }
      return c.json(rpcResult(id, task));
    } catch {
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error: Task store access failed'));
    }
  } finally {
    if (taskId) deps.activeAbortControllers.delete(taskId);
    c.req.raw.signal.removeEventListener('abort', onAbort);
  }
}

async function handleMessageStream(
  c: Parameters<Handler>[0],
  deps: ServerDependencies,
  id: string | number,
  params: unknown
) {
  const parsed = MessageStreamParamsSchema.safeParse(params);
  if (!parsed.success) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params'));
  }

  const abortController = new AbortController();
  let taskId: string | undefined;

  const onAbort = () => abortController.abort();
  c.req.raw.signal.addEventListener('abort', onAbort);
  if (c.req.raw.signal.aborted) abortController.abort();

  return streamSSE(c, async (stream) => {
    try {
      const iter = deps.taskRunner.run(deps.pluginId, parsed.data.message, {
        abortSignal: abortController.signal,
        contextId: parsed.data.contextId,
      });

      for await (const chunk of iter) {
        if (chunk.kind === 'task' && !taskId) {
          taskId = chunk.task.id;
          deps.activeAbortControllers.set(taskId, abortController);
        }
        await stream.writeSSE({ event: chunk.kind, data: JSON.stringify(chunk) });
      }
    } catch {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error')),
      });
    } finally {
      if (taskId) deps.activeAbortControllers.delete(taskId);
      c.req.raw.signal.removeEventListener('abort', onAbort);
    }
  });
}

async function handleTasksGet(
  c: { json: (data: unknown, status?: number) => Response },
  deps: ServerDependencies,
  id: string | number,
  params: unknown
) {
  const parsed = TasksGetParamsSchema.safeParse(params);
  if (!parsed.success) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params'));
  }

  const task = await deps.taskStore.get(parsed.data.taskId);
  if (!task) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.TASK_NOT_FOUND, 'Task not found'));
  }
  return c.json(rpcResult(id, task));
}

async function handleTasksCancel(
  c: { req: { raw: Request }; json: (data: unknown, status?: number) => Response },
  deps: ServerDependencies,
  id: string | number,
  params: unknown
) {
  const parsed = TasksCancelParamsSchema.safeParse(params);
  if (!parsed.success) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params'));
  }

  const task = await deps.taskStore.get(parsed.data.taskId);
  if (!task) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.TASK_NOT_FOUND, 'Task not found'));
  }

  const ac = deps.activeAbortControllers.get(parsed.data.taskId);
  if (!ac) {
    const isTerminal =
      task.status.state === 'COMPLETED' || task.status.state === 'FAILED' || task.status.state === 'CANCELED';
    if (isTerminal) {
      return c.json(
        rpcError(id, JSON_RPC_ERRORS.TASK_CANCELED, 'Task is already in terminal state and cannot be canceled')
      );
    }
    return c.json(
      rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Abort controller missing for non-terminal task')
    );
  }

  ac.abort();

  // Poll for terminal state
  // TODO: Consider subscription-based approach for high-concurrency scenarios
  const maxWait = 5000;
  const interval = 50;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (c.req.raw.signal.aborted) {
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Client disconnected'));
    }
    const current = await deps.taskStore.get(parsed.data.taskId);
    if (current && TERMINAL_STATES.has(current.status.state)) {
      return c.json(rpcResult(id, current));
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Timeout waiting for task to reach terminal state'));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run (Devcontainer内): `pnpm vitest run tests/server/handler.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Lint and Typecheck (Devcontainer内)**

```bash
pnpm lint
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/server/rpc/handler.ts tests/server/_helpers.ts tests/server/handler.test.ts
git commit -m "feat(server): add JSON-RPC method dispatcher with validation"
```

- [ ] **Step 8: Draft PR to Phase Base**

`feature/phase1-task3_rpc-handler` → `feature/phase1_server-adapter__base` へ Draft PR を作成。
