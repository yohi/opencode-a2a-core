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
  `tasks/cancel` で `abort()` 呼び出し、`finally` ブロックで成功・失敗・キャンセルいずれの場合も確実に削除
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
- `auth` 未設定かつ `allowUnauthenticated: true` 未設定の場合、`createA2AServer()` は起動時バリデーションで例外をスローする（フェイルセーフ・デフォルト）
- `auth` 未設定かつ `allowUnauthenticated: true` を明示設定した場合のみ、ミドルウェア自体を適用しない（開発用途、起動時に警告ログを出力）
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
| `TASK_CANCELED` | -32002 | `tasks/cancel` 対象が既に終端状態 (A2A 拡張) |

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
2. `taskId` 変数を `undefined` で初期化
3. `c.req.raw.signal` (クライアント切断) の `abort` イベントを監視
   → 発火時に `AbortController.abort()` 呼び出し（`message/stream` と対称）
   - リスナー登録**直後**に `if (c.req.raw.signal.aborted) abortController.abort()` で同期チェックを実施
   - **根拠 (リソース保護)**: クライアントが HTTP 接続をタイムアウト等で切断した場合、応答先が存在しないままタスクが完走するとリソース消費・DoS リスクとなるため、`message/stream` と同様に切断時は中断する
   - **根拠 (already-aborted race)**: AbortSignal 仕様上、リスナー登録時点で既に `aborted === true` の場合は `abort` イベントが再発火しない。
     ハンドラ到達時点で既にクライアントが切断済みのケース（タイムアウト等）を取りこぼすと、上記リソース保護目的が達成されないため、登録順序「先にリスナー追加 → 後で同期チェック」を厳守する。
     `AbortController.abort()` は冪等のため、リスナー経由と同期チェック経由で二重に呼ばれても問題ない
4. `try` ブロック開始
5. `TaskRunner.run(pluginId, message, { abortSignal, contextId })` のイテレーションを開始
6. 最初のチャンク（`{ kind: 'task', task }`）から `taskId` を取得し、
   `activeAbortControllers.set(taskId, abortController)` で登録
7. 残りのチャンクを全消費
8. 完了後 `TaskStore.get(taskId)` で最終 `Task` を取得し、
   `{ jsonrpc: "2.0", id, result: task }` を返却
9. `catch` ブロック:
   - `taskId` が未取得（最初のチャンク yield 前に `TaskRunner` が throw）の場合: `INTERNAL_ERROR` (-32603) を返却。
     `TaskStore` 上に永続化された `Task` が存在しないため、`TaskStore.get(undefined)` を呼ばず即座にエラー応答とする
   - `taskId` 取得済みの場合: `TaskStore.get(taskId)` で `FAILED` 状態の `Task` を取得して正常レスポンスとして返却
     （`TaskRunner` は最初のチャンク yield 後の throw 前に必ず `FAILED` ステータスを yield・永続化する仕様のため）
10. `finally` ブロック: `taskId` が定義済みであれば `activeAbortControllers.delete(taskId)` を実行、`c.req.raw.signal` のイベントリスナーを解除
    （成功・失敗・キャンセルいずれの経路でもマップへの登録残留・リスナーリークを防止）

#### `message/stream`

1. `AbortController` 生成（この時点では `activeAbortControllers` に未登録）
2. `taskId` 変数を `undefined` で初期化
3. `c.req.raw.signal` (クライアント切断) の `abort` イベントを監視
   → 発火時に `AbortController.abort()` 呼び出し
   - リスナー登録**直後**に `if (c.req.raw.signal.aborted) abortController.abort()` で同期チェックを実施
     （`message/send` と同様、登録時点で既にアボート済みのケースを取りこぼさないため。詳細根拠は `message/send` ステップ3を参照）
4. Hono の `streamSSE` ヘルパーで SSE ストリーム開始
5. `TaskRunner.run()` のイテレーションを開始し、最初のチャンク（`{ kind: 'task', task }`）から
   `taskId` を取得し、`activeAbortControllers.set(taskId, abortController)` で登録
6. 残りのチャンクを逐次 `stream.writeSSE({ event: chunk.kind, data: JSON.stringify(chunk) })` で送信
7. `TaskRunner` の throw は catch して無視
   - `taskId` 取得済み: `FAILED` チャンクは throw 前に yield・送信済みのためそのままストリームを正常終了
   - `taskId` 未取得（最初のチャンク yield 前に throw）: SSE クライアントへエラーイベントを1件送信した上でストリームを終了
     - `event: error`
     - `data`: JSON-RPC 2.0 エラーレスポンス形式の JSON 文字列
       `{ "jsonrpc": "2.0", "id": <元リクエストの id>, "error": { "code": -32603, "message": <エラー詳細> } }`
     - **設計根拠**: HTTP の RPC エラーレスポンスと完全同一の envelope を採用することで、クライアントは同一の JSON-RPC エラーパーサ・型定義を HTTP / SSE 両経路で再利用可能。`id` で元リクエストとの相関も取れる
     - `id` は元の JSON-RPC リクエストの `id` をそのまま転記。リクエストに `id` フィールドがない（通知形態）の場合は `null` を設定
     - `code` は `JSON_RPC_ERRORS.INTERNAL_ERROR` (-32603) を使用
8. `finally` で `taskId` が定義済みであれば `activeAbortControllers.delete(taskId)` を実行、イベントリスナー解除

#### `tasks/get`

1. `TaskStore.get(taskId)` 呼び出し
2. 見つからなければ `TASK_NOT_FOUND` エラー
3. `{ jsonrpc: "2.0", id, result: task }` を返却

#### `tasks/cancel`

1. `TaskStore.get(taskId)` でタスクの存在を確認
2. 見つからなければ `TASK_NOT_FOUND` (-32001) エラーを返却
3. `activeAbortControllers.get(taskId)` を検索
4. `activeAbortControllers` に登録が**ない**場合（タスクが既に終端状態に遷移済みで `finally` により削除済み）:
   `TASK_CANCELED` (-32002) エラーを返却（message: "Task is already in terminal state and cannot be canceled"）
   - クライアントは `tasks/get` で最終状態を取得可能
   - **根拠**: 「不在」と「終端状態済み」を明確に区別することで、クライアントの再試行・状態同期ロジックを単純化
5. `activeAbortControllers` に登録が**ある**場合: `abortController.abort()` を呼び出し
6. `TaskStore` をポーリングし、タスクが終端状態（`TASK_STATE_CANCELED` / `TASK_STATE_COMPLETED` / `TASK_STATE_FAILED`）に遷移するまで待機
   - ポーリング間隔: 50ms、最大待機: 5000ms（タイムアウト時は `INTERNAL_ERROR`）
   - **根拠**: `abort()` は非同期のシグナル送信であり、実際の状態永続化は `TaskRunner` のイテレーションサイクル内で行われる。レスポンス前に永続化を確認することで、クライアントが受け取る `Task` オブジェクトの状態一貫性を保証する
7. `TaskStore.get(taskId)` で最終 `Task` を取得
8. `{ jsonrpc: "2.0", id, result: task }` を返却

**API セマンティクスに関する注意事項**:

`tasks/cancel` のレスポンスとして返却される `Task` は必ずしも `CANCELED` 状態とは限らない。
ステップ5で `abort()` を呼び出した時点でタスクが既に最終チャンクの永続化フェーズに入っている等のレースが発生した場合、`TaskRunner` は `CANCELED` ではなく `COMPLETED` または `FAILED` で終端する。
クライアントは返却された `Task.status.state` を必ず確認し、`CANCELED` を前提とした処理を行わないこと。
本仕様では「キャンセル要求の受理 + 終端状態への確実な到達」を保証するが、終端状態の種別はタイミング次第である。

### 4. Server Factory (`src/server/index.ts`)

**公開API**:

```typescript
interface CreateA2AServerOptions {
  plugin: A2APluginInterface;
  taskStore?: TaskStore;                    // default: InMemoryTaskStore
  logger?: Logger;                          // default: ConsoleLogger
  auth?: { token: string };                 // デフォルト: 認証必須（未設定かつ allowUnauthenticated 未設定は起動エラー）
  allowUnauthenticated?: boolean;           // 開発用途で auth スキップを明示する opt-out フラグ (default: false)
  baseUrl?: string;                         // AgentCard.url に使用するサーバー公開 URL（リバースプロキシ環境での明示用）
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
  "url": "<resolved-base-url>",
  "version": "<plugin.version>",
  "capabilities": { "streaming": true },
  "skills": [...]
}
```

**`url` フィールドの決定ロジック**:

リバースプロキシ経由で公開される一般的なデプロイ構成において、`request.url` のオリジンはプロキシ内部のアドレスとなり、A2A クライアントが正しい接続先を取得できなくなる問題を回避するため、以下の優先順位で解決する:

1. `CreateA2AServerOptions.baseUrl` が設定されている場合: その値をそのまま使用（最優先・明示設定）
2. `X-Forwarded-Proto` および `X-Forwarded-Host` ヘッダーが両方存在する場合:
   `${X-Forwarded-Proto}://${X-Forwarded-Host}` をオリジンとして使用
   - `X-Forwarded-Host` がカンマ区切りの複数ホストを含む場合は最左の値を採用（RFC 7239 / X-Forwarded-* デファクト準拠）
3. 上記いずれも該当しない場合: `new URL(c.req.url).origin` を使用（フォールバック）

本番環境（リバースプロキシ配下）では `baseUrl` の明示設定を強く推奨する。`X-Forwarded-*` ヘッダーは信頼できるプロキシ配下でのみ意味を持つため、依存する場合はプロキシでの上書き設定が前提となる。

## Testing Strategy

**テストフレームワーク**: Vitest + `app.request()`（実サーバー起動不要）

### テストケース一覧

| カテゴリ | ケース | 検証内容 |
|---|---|---|
| **認証** | ヘッダー欠如 | 401 返却 |
| | 不正トークン | 401 返却 |
| | 正しいトークン | 後続処理に到達 |
| | auth 未設定 + allowUnauthenticated 未設定 | `createA2AServer()` が起動時例外スロー |
| | auth 未設定 + allowUnauthenticated: true | 認証スキップ + 警告ログ出力 |
| **JSON-RPC バリデーション** | 不正 JSON body | -32700 Parse error |
| | `jsonrpc: "1.0"` | -32600 Invalid Request |
| | `method: "unknown"` | -32601 Method not found |
| | params 不正 | -32602 Invalid params |
| **message/send** | 正常系 | Task (COMPLETED) 返却 |
| | プラグインエラー（taskId 取得後 throw） | FAILED 状態の Task を正常レスポンスで返却 |
| | 最初のチャンク前 throw（taskId 未取得） | -32603 Internal error |
| | クライアント切断（`c.req.raw.signal` abort） | `AbortController.abort()` 呼び出し検証 |
| | 事前 abort 済み signal で起動（already-aborted race） | `AbortController.abort()` が同期チェック経路で呼び出される（リスナー未発火でも検出） |
| | catch / finally 経路 | `activeAbortControllers` から taskId が削除される（リーク防止） |
| **tasks/get** | 存在するタスク | Task 返却 |
| | 存在しないID | -32001 Task not found |
| **tasks/cancel** | アクティブタスク | CANCELED 状態の Task オブジェクト返却 |
| | キャンセル直前に自然完了したタスク（race condition） | COMPLETED 状態の Task オブジェクトを返却（エラーではなく `result` で返す） |
| | 不在タスク（TaskStore にもなし） | -32001 Task not found |
| | 既に終端状態のタスク（TaskStore に存在） | -32002 Task canceled |
| | 終端状態待機タイムアウト | -32603 Internal error |
| **message/stream** | 正常系 | Content-Type: text/event-stream、イベント形式検証 |
| | 最初のチャンク前 throw（taskId 未取得） | `event: error` + `data: { jsonrpc: "2.0", id: <req.id>, error: { code: -32603, message: ... } }` を1件送信して終了 |
| | 最初のチャンク前 throw（リクエスト id なし） | SSE エラーイベントの `data.id` が `null` |
| | SSE 切断検知 | `AbortController.abort()` 呼び出し検証 |
| | 事前 abort 済み signal で起動（already-aborted race） | `AbortController.abort()` が同期チェック経路で呼び出される（リスナー未発火でも検出） |
| **AgentCard** | GET 正常系 | プラグインメタデータの JSON 返却 |
| | `baseUrl` 明示設定 | `url` フィールドが設定値と一致 |
| | `X-Forwarded-Proto` + `X-Forwarded-Host` 設定（baseUrl 未指定） | `url` フィールドがヘッダー由来のオリジンと一致 |
| | 何も設定なし | `url` フィールドが `request.url` のオリジンと一致（フォールバック） |

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
