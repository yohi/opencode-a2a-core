# HTTP Server Adapter Implementation Plan (Part 1/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `opencode-a2a-core` のコア層をラップし、JSON-RPC 2.0 / SSE で安全に通信する HTTP サーバーアダプタを実装する。

**Architecture:** Hono フレームワーク上にファクトリ関数 `createA2AServer()` を構築。Bearer 認証ミドルウェア → JSON-RPC スキーマ検証 → メソッドディスパッチの3層構成。1サーバー = 1プラグインモデル。

**Tech Stack:** TypeScript, Node.js v22, Hono, Zod, Vitest, pnpm

---

## Git Branch Strategy

```text
master
 └─ feature/phase1_server-adapter__base
      ├─ feature/phase1-task1_rpc-schema        (← Base)
      ├─ feature/phase1-task2_auth-middleware    (← Base)
      ├─ feature/phase1-task3_rpc-handler       (← Task2: auth依存)
      ├─ feature/phase1-task4_server-factory     (← Task3: handler依存)
      └─ feature/phase1-task5_stream-cancel      (← Task4: factory依存)
```

## File Structure

```text
src/server/
├── middleware/
│   └── auth.ts          # Bearer 認証ミドルウェア
├── rpc/
│   ├── schema.ts        # JSON-RPC 2.0 Zod スキーマ
│   └── handler.ts       # RPC メソッドディスパッチャ
└── index.ts             # createA2AServer() ファクトリ

tests/server/
├── _helpers.ts          # テスト用ヘルパー
├── schema.test.ts       # スキーマ単体テスト
├── auth.test.ts         # 認証ミドルウェアテスト
├── handler.test.ts      # ハンドラテスト
└── index.test.ts        # 結合テスト
```

---

## Prerequisites: hono 依存追加

```bash
pnpm add hono
```

---

## Phase 1: Server Adapter 実装

### Task 1: JSON-RPC Schema (`src/server/rpc/schema.ts`)

**派生元:** `feature/phase1_server-adapter__base` (Base) — 他タスクに依存しない独立モジュール

**Files:**
- Create: `src/server/rpc/schema.ts`
- Test: `tests/server/schema.test.ts`

- [ ] **Step 1: Write the failing test for schema**

```typescript
// tests/server/schema.test.ts
import { describe, it, expect } from 'vitest';
import {
  JsonRpcRequestSchema,
  MessageSendParamsSchema,
  MessageStreamParamsSchema,
  TasksGetParamsSchema,
  TasksCancelParamsSchema,
  JSON_RPC_ERRORS,
} from '../../src/server/rpc/schema.js';

describe('JsonRpcRequestSchema', () => {
  it('accepts valid request with id', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid request with string id', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'abc-123',
      method: 'message/send',
    });
    expect(result.success).toBe(true);
  });

  it('accepts notification (no id)', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'message/send',
    });
    expect(result.success).toBe(true);
  });

  it('rejects wrong jsonrpc version', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '1.0',
      id: 1,
      method: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing method', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('MessageSendParamsSchema', () => {
  it('accepts valid params', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: { role: 'ROLE_USER', parts: [{ kind: 'text', text: 'hello' }] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts params with contextId', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: { role: 'ROLE_USER', parts: [{ kind: 'text', text: 'hello' }] },
      contextId: 'ctx-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing message', () => {
    const result = MessageSendParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TasksGetParamsSchema', () => {
  it('accepts valid params', () => {
    const result = TasksGetParamsSchema.safeParse({ taskId: 'task-1' });
    expect(result.success).toBe(true);
  });

  it('rejects missing taskId', () => {
    const result = TasksGetParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TasksCancelParamsSchema', () => {
  it('accepts valid params', () => {
    const result = TasksCancelParamsSchema.safeParse({ taskId: 'task-1' });
    expect(result.success).toBe(true);
  });
});

describe('JSON_RPC_ERRORS', () => {
  it('has all required error codes', () => {
    expect(JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700);
    expect(JSON_RPC_ERRORS.INVALID_REQUEST).toBe(-32600);
    expect(JSON_RPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
    expect(JSON_RPC_ERRORS.INVALID_PARAMS).toBe(-32602);
    expect(JSON_RPC_ERRORS.INTERNAL_ERROR).toBe(-32603);
    expect(JSON_RPC_ERRORS.TASK_NOT_FOUND).toBe(-32001);
    expect(JSON_RPC_ERRORS.TASK_CANCELED).toBe(-32002);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (Devcontainer内): `pnpm vitest run tests/server/schema.test.ts`
Expected: FAIL — モジュールが存在しない

- [ ] **Step 3: Write implementation**

```typescript
// src/server/rpc/schema.ts
import { z } from 'zod';
import { MessageSchema } from '../../core/a2a-types.js';

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const MessageSendParamsSchema = z.object({
  message: MessageSchema,
  contextId: z.string().optional(),
});

export const MessageStreamParamsSchema = z.object({
  message: MessageSchema,
  contextId: z.string().optional(),
});

export const TasksGetParamsSchema = z.object({
  taskId: z.string(),
});

export const TasksCancelParamsSchema = z.object({
  taskId: z.string(),
});

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_CANCELED: -32002,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run (Devcontainer内): `pnpm vitest run tests/server/schema.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Lint and Typecheck (Devcontainer内)**

```bash
pnpm lint
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/rpc/schema.ts tests/server/schema.test.ts
git commit -m "feat(server): add JSON-RPC 2.0 Zod schema definitions"
```

- [ ] **Step 7: Draft PR to Phase Base**

`feature/phase1-task1_rpc-schema` → `feature/phase1_server-adapter__base` へ Draft PR を作成。
