# HTTP Server Adapter — Design Specification

## Overview

`opencode-a2a-core` のコア層（`TaskRunner`, `TaskStore`, `PluginRegistry`）をラップし、
外部クライアントと JSON-RPC 2.0 / SSE で安全に通信するための HTTP サーバーアダプタを実装する。

SPEC.md 第7項「今後の拡張 (HTTP サーバー層 / Server Adapter)」の実現。

## Design Decisions

| # | 判断事項 | 決定 | 根拠 |
|---|---|---|---|
| D1 | `message/send` の振る舞い | 同期完了待機型 | A2A v1.0.0 仕様準拠。`message/stream` との役割分離が明確。AbortSignal で自然なタイムアウト制御可能 |
| D2 | プラグインルーティング | 1サーバー = 1プラグイン | A2A の「1エージェント = 1能力セット」モデルに合致。ルーティング複雑性を排除 |
| D3 | 公開API形式 | ファクトリ関数 `createA2AServer()` → `Hono` アプリ返却 | テスト容易性。独自ミドルウェア追加の柔軟性。ライフサイクル管理を利用者に委譲 |
| D4 | ファイル構成 | フラットモジュール（4ファイル + テスト1ファイル） | ファイル数と責務のバランス。既存コア層の設計哲学と整合 |

## Technology Stack

- **Runtime**: Node.js v22
- **Server Framework**: `hono` + `@hono/node-server`
- **Validation**: `zod` (既存依存)
- **Test**: `vitest` + `app.request()` (実サーバー起動不要)
- **Package Manager**: pnpm

## File Structure

```text
src/server/
├── middleware/
│   └── auth.ts          # Bearer 認証ミドルウェア
├── rpc/
│   ├── schema.ts        # JSON-RPC 2.0 Zod スキーマ定義
│   └── handler.ts       # RPC メソッドディスパッチャ
└── index.ts             # createA2AServer() ファクトリ + AgentCard ハンドラ

tests/server/
└── index.test.ts        # 全エンドポイント結合テスト
```

## Architecture

### Data Flow

```text
Client
  │
  ▼
[Hono App] ── auth middleware ──▶ Bearer Token 検証
  │
  ├─ POST /  ──▶ [RPC Handler]
  │                 ├─ message/send   ──▶ TaskRunner.run() 全消費 → Task 返却
  │                 ├─ message/stream ──▶ TaskRunner.run() → SSE ストリーム
  │                 ├─ tasks/get      ──▶ TaskStore.get()
  │                 └─ tasks/cancel   ──▶ AbortController.abort() → 終端状態待機 → Task 返却
  │
  └─ GET /.well-known/agent.json ──▶ Plugin.metadata() 集約
```

### Shared State (Singleton)

```typescript
interface ServerDependencies {
  taskStore: TaskStore;
  registry: PluginRegistry;
  taskRunner: TaskRunner;
  pluginId: string;
  activeAbortControllers: Map<string, AbortController>;
  logger: Logger;
}
```

- `activeAbortControllers`: `message/send` / `message/stream` でタスク起動時に登録、
  `tasks/cancel` で `abort()` 呼び出し、タスク完了時に削除
- `taskStore`: すべてのエンドポイント間で共有するシングルトン

## Component Details

### 1. Auth Middleware (`src/server/middleware/auth.ts`)

**責務**: Bearer トークンの検証。タイミング攻撃防止。

**公開API**:

```typescript
function bearerAuth(expectedToken: string): MiddlewareHandler;
```

**セキュリティ設計**:

- `crypto.timingSafeEqual` で固定長バッファ比較
- `expectedToken` → `Buffer` 変換は起動時に1回のみ実行
- 長さ不一致時: `Buffer.alloc(expectedBuf.length)` でゼロバッファを生成し、
  `timingSafeEqual` で比較後、`&& isLengthMatch` で論理AND
  → 長さ情報のタイミング漏洩を防止
- `auth` オプション省略時はミドルウェア自体を適用しない（開発用途）
- レスポンス: プレーン JSON `{ error: "..." }` + HTTP 401

### 2. JSON-RPC Schema (`src/server/rpc/schema.ts`)

**責務**: JSON-RPC 2.0 リクエストおよび各メソッドの params の Zod スキーマ定義。

**スキーマ一覧**:

| スキーマ | 用途 |
|---|---|
| `JsonRpcRequestSchema` | `{ jsonrpc: "2.0", id?, method, params? }` の基本検証 |
| `MessageSendParamsSchema` | `{ message: Message, contextId? }` |
| `MessageStreamParamsSchema` | `{ message: Message, contextId? }` |
| `TasksGetParamsSchema` | `{ taskId: string }` |
| `TasksCancelParamsSchema` | `{ taskId: string }` |

**エラーコード定数** (`JSON_RPC_ERRORS`):

| 名前 | コード | 用途 |
|---|---|---|
| `PARSE_ERROR` | -32700 | JSON パース失敗 |
| `INVALID_REQUEST` | -32600 | JSON-RPC 構造不正 |
| `METHOD_NOT_FOUND` | -32601 | 未知メソッド |
| `INVALID_PARAMS` | -32602 | params 検証失敗 |
| `INTERNAL_ERROR` | -32603 | 内部エラー |
| `TASK_NOT_FOUND` | -32001 | タスク不在 (A2A 拡張) |
| `TASK_CANCELED` | -32002 | キャンセル済み (A2A 拡張) |

### 3. RPC Handler (`src/server/rpc/handler.ts`)

**責務**: JSON-RPC リクエストの受信、バリデーション、メソッドディスパッチ。

**処理フロー**:

```text
POST /
  → JSON パース（失敗 → PARSE_ERROR）
  → JsonRpcRequestSchema 検証（失敗 → INVALID_REQUEST）
  → method 名でディスパッチ（不明 → METHOD_NOT_FOUND）
  → params スキーマ検証（失敗 → INVALID_PARAMS）
  → 実行
```

**各メソッドの振る舞い**:

#### `message/send`

1. `AbortController` 生成（この時点では `activeAbortControllers` に未登録）
2. `TaskRunner.run(pluginId, message, { abortSignal, contextId })` のイテレーションを開始
3. 最初のチャンク（`{ kind: 'task', task }`）から `taskId` を取得し、
   `activeAbortControllers.set(taskId, abortController)` で登録
4. 残りのチャンクを全消費
5. 完了後 `TaskStore.get(taskId)` で最終 `Task` 取得
6. `activeAbortControllers` から削除
7. `{ jsonrpc: "2.0", id, result: task }` を返却
8. `TaskRunner` が throw した場合は catch し、`TaskStore.get(taskId)` で `FAILED` 状態の `Task` を取得して正常レスポンスとして返却（`TaskRunner` は throw 前に必ず `FAILED` ステータスを yield・永続化する仕様のため）

#### `message/stream`

1. `AbortController` 生成（この時点では `activeAbortControllers` に未登録）
2. `c.req.raw.signal` (クライアント切断) の `abort` イベントを監視
   → 発火時に `AbortController.abort()` 呼び出し
3. Hono の `streamSSE` ヘルパーで SSE ストリーム開始
4. `TaskRunner.run()` のイテレーションを開始し、最初のチャンク（`{ kind: 'task', task }`）から
   `taskId` を取得し、`activeAbortControllers.set(taskId, abortController)` で登録
5. 残りのチャンクを逐次 `stream.writeSSE({ event: chunk.kind, data: JSON.stringify(chunk) })` で送信
6. `TaskRunner` の throw は catch して無視（FAILED ステータスは throw 前に yield 済み）
7. `finally` で `activeAbortControllers` から削除、イベントリスナー解除

#### `tasks/get`

1. `TaskStore.get(taskId)` 呼び出し
2. 見つからなければ `TASK_NOT_FOUND` エラー
3. `{ jsonrpc: "2.0", id, result: task }` を返却

#### `tasks/cancel`

1. `activeAbortControllers.get(taskId)` を検索
2. 見つからなければ `TASK_NOT_FOUND` エラー
3. `abortController.abort()` を呼び出し
4. `TaskStore` をポーリングし、タスクが終端状態（`TASK_STATE_CANCELED` / `TASK_STATE_COMPLETED` / `TASK_STATE_FAILED`）に遷移するまで待機
   - ポーリング間隔: 50ms、最大待機: 5000ms（タイムアウト時は `INTERNAL_ERROR`）
   - **根拠**: `abort()` は非同期のシグナル送信であり、実際の状態永続化は `TaskRunner` のイテレーションサイクル内で行われる。レスポンス前に永続化を確認することで、クライアントが受け取る `Task` オブジェクトの状態一貫性を保証する
5. `TaskStore.get(taskId)` で最終 `Task` を取得
6. `{ jsonrpc: "2.0", id, result: task }` を返却

### 4. Server Factory (`src/server/index.ts`)

**公開API**:

```typescript
interface CreateA2AServerOptions {
  plugin: A2APluginInterface;
  taskStore?: TaskStore;                    // default: InMemoryTaskStore
  logger?: Logger;                          // default: ConsoleLogger
  auth?: { token: string };                 // default: 認証なし
  taskRunnerOptions?: Partial<TaskRunnerOptions>;
}

function createA2AServer(options: CreateA2AServerOptions): Hono;
```

**TaskRunner デフォルトオプション**:

```typescript
{
  maxAttempts: 3,
  initialBackoffMs: 100,
  maxBackoffMs: 10_000,
  backoffMultiplier: 2,
  jitterRatio: 0.1,
}
```

**AgentCard** (`GET /.well-known/agent.json`):

```json
{
  "name": "<pluginId>",
  "url": "<origin>",
  "version": "<plugin.version>",
  "capabilities": { "streaming": true },
  "skills": [...]
}
```

## Testing Strategy

**テストフレームワーク**: Vitest + `app.request()`（実サーバー起動不要）

### テストケース一覧

| カテゴリ | ケース | 検証内容 |
|---|---|---|
| **認証** | ヘッダー欠如 | 401 返却 |
| | 不正トークン | 401 返却 |
| | 正しいトークン | 後続処理に到達 |
| | auth 未設定時 | 認証スキップ |
| **JSON-RPC バリデーション** | 不正 JSON body | -32700 Parse error |
| | `jsonrpc: "1.0"` | -32600 Invalid Request |
| | `method: "unknown"` | -32601 Method not found |
| | params 不正 | -32602 Invalid params |
| **message/send** | 正常系 | Task (COMPLETED) 返却 |
| | プラグインエラー | FAILED 状態の Task を正常レスポンスで返却 |
| **tasks/get** | 存在するタスク | Task 返却 |
| | 存在しないID | -32001 Task not found |
| **tasks/cancel** | アクティブタスク | CANCELED 状態の Task オブジェクト返却 |
| | 不在タスク | -32001 Task not found |
| | 終端状態待機タイムアウト | -32603 Internal error |
| **message/stream** | 正常系 | Content-Type: text/event-stream、イベント形式検証 |
| | SSE 切断検知 | AbortController.abort() 呼び出し検証 |
| **AgentCard** | GET 正常系 | プラグインメタデータの JSON 返却 |

### テストヘルパー

```typescript
// テスト用プラグインファクトリ
function createTestPlugin(id, executeFn): A2APluginInterface;

// JSON-RPC リクエスト構築
function rpcRequest(method, params?, id?): Request;
```

## Dependencies to Add

```json
{
  "dependencies": {
    "hono": "^4.0.0"
  }
}
```

`hono` 本体が `package.json` に未登録のため追加が必要。
`@hono/node-server` は既に登録済み。

## Scope Boundaries

以下は本設計のスコープ **外** とする:

- HTTPS / TLS 終端（リバースプロキシに委譲）
- レート制限（将来のミドルウェアとして追加可能）
- マルチプラグインルーティング（D2 により除外、将来拡張可能）
- 永続的な TaskStore 実装（Redis 等）
- CORS 設定（利用者が Hono ミドルウェアで追加可能）
