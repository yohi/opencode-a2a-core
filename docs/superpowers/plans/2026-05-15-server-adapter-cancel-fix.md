# Server Adapter Cancel Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tasks/cancel` エンドポイントの実装において、すでに終端状態のタスクに対するエラー返却（-32002）と、キャンセル時の終端状態へのポーリング待機の欠落を是正する。

**Architecture:** `src/server/rpc/handler.ts` の `handleTasksCancel` において、`activeAbortControllers` にコントローラが無いかつ終端状態のタスクには `TASK_CANCELED` エラーを返し、`abort()` 実行後は `TaskStore` を最大5000msポーリングして状態の一貫性を担保する。

**Tech Stack:** TypeScript, Node.js v22, Hono, Vitest, pnpm

---

### Task 1: Fix `TASK_CANCELED` error behavior for already terminal tasks

**Files:**
- Modify: `tests/server/index.test.ts`
- Modify: `src/server/rpc/handler.ts`

- [ ] **Step 1: Update the test to expect an error**

`tests/server/index.test.ts` を修正し、すでに完了しているタスクのキャンセルがエラーになることを検証します。
該当テスト `'tasks/cancel returns task state for already terminal task'` を以下に置き換えてください。

```typescript
  it('tasks/cancel returns TASK_CANCELED error for already terminal task', async () => {
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
    const bodyCancel = await resCancel.json() as { error: { code: number; message: string } };
    expect(bodyCancel.error).toBeDefined();
    expect(bodyCancel.error.code).toBe(-32002); // JSON_RPC_ERRORS.TASK_CANCELED
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/server/index.test.ts -t "already terminal task"
```
Expected: FAIL (現状は正常レスポンスが返るため)

- [ ] **Step 3: Fix the implementation in handler**

`src/server/rpc/handler.ts` の `handleTasksCancel` 関数内（249行目付近）を以下のように書き換えます。

```typescript
  const ac = deps.activeAbortControllers.get(parsed.data.taskId);
  if (!ac) {
    const isTerminal = TERMINAL_STATES.has(task.status.state);
    if (isTerminal) {
      return c.json(
        rpcError(
          id,
          JSON_RPC_ERRORS.TASK_CANCELED,
          'Task is already in terminal state and cannot be canceled'
        )
      );
    }
    return c.json(
      rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Abort controller missing for non-terminal task')
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/server/index.test.ts -t "already terminal task"
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/server/index.test.ts src/server/rpc/handler.ts
git commit -m "fix(server): return TASK_CANCELED error for already terminal tasks in tasks/cancel"
```

---

### Task 2: Implement terminal state polling for task cancellation

**Files:**
- Modify: `tests/server/index.test.ts`
- Modify: `src/server/rpc/handler.ts`

- [ ] **Step 1: Update race condition test to expect terminal state**

`tests/server/index.test.ts` の `'tasks/cancel returns COMPLETED task if it completes during cancellation race'` テスト末尾のアサーション部分（626行目付近）を以下のように修正します。`WORKING` ステータスを許容せず、ポーリングにより必ず終端状態が返ることをアサートします。

```typescript
    // The result should be the successfully completed task
    // or if cancel won the race, the canceled task
    if ('result' in bodyCancel) {
      expect(bodyCancel.result.status.state).toMatch(/COMPLETED|CANCELED|FAILED/);
    } else if ('error' in bodyCancel) {
      // Cancel might have completed first, or task might have already finished
      expect([-32002, -32004]).toContain(bodyCancel.error.code);
    } else {
      throw new Error(`Unexpected response format: ${JSON.stringify(bodyCancel)}`);
    }
  }, 15000);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/server/index.test.ts -t "cancellation race"
```
Expected: FAIL (現状は `ac.abort()` 直後の `WORKING` 状態がそのまま返るため)

- [ ] **Step 3: Implement polling in handler**

`src/server/rpc/handler.ts` の `handleTasksCancel` 関数内（262行目付近、`ac.abort();` の後）を以下のように修正します。

```typescript
  ac.abort();

  // Poll for terminal state
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

  return c.json(
    rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Timeout waiting for task to reach terminal state')
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/server/index.test.ts -t "cancellation race"
```
Expected: PASS

- [ ] **Step 5: Run all tests**

```bash
pnpm test
```
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add tests/server/index.test.ts src/server/rpc/handler.ts
git commit -m "fix(server): poll for terminal state during task cancellation"
```
