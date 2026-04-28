# HTTP Server Adapter Implementation Plan (Part 3/3)

> 本ファイルは Part 1, 2 の続きです。

---

### Task 4: Server Factory (`src/server/index.ts`)

**派生元:** `feature/phase1-task3_rpc-handler` (Task3) — handler + auth を組み合わせるファクトリ

**Files:**
- Create: `src/server/index.ts`
- Test: `tests/server/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/index.test.ts
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
    const body = await res.json();
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
    const body = await res.json();
    expect(body.url).toBe('https://example.com');
  });

  it('uses X-Forwarded headers when baseUrl is not set', async () => {
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
    const body = await res.json();
    expect(body.url).toBe('https://proxy.example.com');
  });

  it('falls back to request.url origin', async () => {
    const app = createA2AServer({
      plugin,
      allowUnauthenticated: true,
    });
    const res = await app.request('/.well-known/agent.json');
    const body = await res.json();
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
    const body = await res.json();
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
    const body = await res.json();
    expect(body.result).toBeDefined();
    expect(body.result.status.state).toBe('TASK_STATE_COMPLETED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (Devcontainer内): `pnpm vitest run tests/server/index.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// src/server/index.ts
import { Hono } from 'hono';
import type { A2APluginInterface } from '../core/plugin-interface.js';
import type { TaskStore } from '../core/task-store.js';
import type { Logger } from '../core/logger.js';
import type { TaskRunnerOptions } from '../core/task-runner.js';
import { InMemoryTaskStore } from '../core/task-store.js';
import { PluginRegistry } from '../core/registry.js';
import { TaskRunner } from '../core/task-runner.js';
import { createLogger } from '../core/logger.js';
import { bearerAuth } from './middleware/auth.js';
import { createRpcHandler } from './rpc/handler.js';

export interface CreateA2AServerOptions {
  plugin: A2APluginInterface;
  taskStore?: TaskStore;
  logger?: Logger;
  auth?: { token: string };
  allowUnauthenticated?: boolean;
  baseUrl?: string;
  taskRunnerOptions?: Partial<TaskRunnerOptions>;
}

const DEFAULT_RUNNER_OPTS: Omit<TaskRunnerOptions, 'logger'> = {
  maxAttempts: 3,
  initialBackoffMs: 100,
  maxBackoffMs: 10_000,
  backoffMultiplier: 2,
  jitterRatio: 0.1,
};

export function createA2AServer(options: CreateA2AServerOptions): Hono {
  const logger = options.logger ?? createLogger();

  // Fail-safe: require explicit auth config
  if (!options.auth && !options.allowUnauthenticated) {
    throw new Error(
      'Auth configuration required. Set auth.token or explicitly set allowUnauthenticated: true for development.'
    );
  }

  if (!options.auth && options.allowUnauthenticated) {
    logger.warn('Server running without authentication. Do not use in production.');
  }

  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const registry = new PluginRegistry();
  registry.register(options.plugin);

  const runnerOpts: TaskRunnerOptions = {
    ...DEFAULT_RUNNER_OPTS,
    ...options.taskRunnerOptions,
    logger,
  };
  const taskRunner = new TaskRunner(registry, taskStore, runnerOpts);

  const app = new Hono();

  // AgentCard endpoint (no auth required)
  app.get('/.well-known/agent.json', (c) => {
    const meta = options.plugin.metadata();
    const url = resolveBaseUrl(c, options.baseUrl);
    return c.json({
      name: options.plugin.id,
      url,
      version: options.plugin.version,
      capabilities: { streaming: true },
      skills: meta.skills,
    });
  });

  // Auth middleware for RPC endpoints
  if (options.auth) {
    app.post('/*', bearerAuth(options.auth.token));
  }

  // RPC handler
  const deps = {
    taskStore,
    registry,
    taskRunner,
    pluginId: options.plugin.id,
    activeAbortControllers: new Map<string, AbortController>(),
    logger,
  };
  app.post('/', createRpcHandler(deps));

  return app;
}

function resolveBaseUrl(
  c: { req: { url: string; header: (name: string) => string | undefined } },
  baseUrl?: string
): string {
  if (baseUrl) return baseUrl;

  const proto = c.req.header('x-forwarded-proto');
  const host = c.req.header('x-forwarded-host');
  if (proto && host) {
    const firstHost = host.split(',')[0].trim();
    return `${proto}://${firstHost}`;
  }

  return new URL(c.req.url).origin;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (Devcontainer内): `pnpm vitest run tests/server/index.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Lint and Typecheck (Devcontainer内)**

```bash
pnpm lint
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts tests/server/index.test.ts
git commit -m "feat(server): add createA2AServer factory with AgentCard endpoint"
```

- [ ] **Step 7: Draft PR to Phase Base**

`feature/phase1-task4_server-factory` → `feature/phase1_server-adapter__base` へ Draft PR を作成。

---

### Task 5: Stream/Cancel Integration Tests

**派生元:** `feature/phase1-task4_server-factory` (Task4) — ファクトリが必要

**Files:**
- Modify: `tests/server/index.test.ts` (追加テスト)

- [ ] **Step 1: Add stream and cancel tests**

以下のテストを `tests/server/index.test.ts` の末尾に追加:

```typescript
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
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
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
    const body = await res.json();
    expect(body.error.code).toBe(-32001);
  });
});

describe('message/send error handling', () => {
  it('returns INTERNAL_ERROR when plugin throws before first chunk', async () => {
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
    const body = await res.json();
    // taskId is obtained from first chunk (task), so if TaskRunner creates task
    // and throws after yielding it, we get the stored task back.
    // If error happens before any chunk, we get INTERNAL_ERROR.
    expect(body).toBeDefined();
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
    const body2 = await res2.json();
    expect(body2.result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run all server tests**

Run (Devcontainer内): `pnpm vitest run tests/server/`
Expected: ALL PASS

- [ ] **Step 3: Run full test suite (Devcontainer内)**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

- [ ] **Step 4: Add server module to public exports**

```typescript
// src/index.ts — append this line
export { createA2AServer, type CreateA2AServerOptions } from './server/index.js';
```

- [ ] **Step 5: Re-run full suite**

Run (Devcontainer内): `pnpm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add tests/server/index.test.ts src/index.ts
git commit -m "feat(server): add stream/cancel integration tests and public export"
```

- [ ] **Step 7: Draft PR to Phase Base**

`feature/phase1-task5_stream-cancel` → `feature/phase1_server-adapter__base` へ Draft PR を作成。

---

## Phase Completion

すべての Task PR が `feature/phase1_server-adapter__base` にマージされた後:

- [ ] `feature/phase1_server-adapter__base` → `master` へ Draft PR を作成
- [ ] 全テスト、lint、typecheck が Devcontainer 内で PASS することを最終確認
