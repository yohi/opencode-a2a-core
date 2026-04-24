# opencode-a2a-core 設計書

- **Date**: 2026-04-24
- **Status**: Draft (pending user review)
- **Target A2A Protocol Version**: 1.0.0
- **Runtime**: Node.js 22 LTS / pnpm / Vitest / Zod / Hono

## 0. 目的とスコープ

### 0.1 背景

これまで `GeminiCLI` や `CursorCLI` 向けに個別に作成されていた A2A 連携実装を、共通の「A2A コア基盤」として集約する。Gemini、Cursor、ClaudeCode などの各エージェント特有の処理は「プラグイン」として容易に追加・切り替えできるモジュールアーキテクチャを構築する。

### 0.2 本リポジトリが提供するもの

1. **純 A2A プロトコル層**（`src/core/`）: Zod 型、プラグイン契約、`TaskRunner`、`TaskStore`、設定ローダ。
2. **標準 HTTP サーバアダプタ**（`src/server/`）: JSON-RPC 2.0 + SSE + AgentCard + Bearer 認証。
3. **プラグイン実装例**（`src/plugins/gemini-cli-plugin.ts`）: Gemini CLI を背後に持つプラグイン。
4. **Devcontainer**: テスト・静的解析を再現可能な環境内で実行する開発環境定義。

### 0.3 スコープ外（初期リリース）

- SQLite / Redis バックエンドの `TaskStore` 実装（インターフェースのみ提供、既定は `InMemoryTaskStore`）。
- Push Notification（A2A v1.0.0 の任意機能）。
- 複数プラグインへのファンアウト・ルーティング（1リクエスト=1プラグイン前提）。
- Cursor CLI / ClaudeCode プラグインの実コード（契約遵守の例示は Gemini で示す）。

## 1. 基本思想：非対称委任モデル

本システムは「主導権集中アプローチ」に基づき、上位のマスターエージェント（エージェント A）からの指示を受け取る **薄いラッパー（Thin Wrapper）** としての実行エージェント（エージェント B）を構築するための共通基盤である。

- **ヘッドレス（Headless）**: 本システムは独自の広範な推論を行わない。Semantic Drift の要因となる「勝手な解釈・補正」を排する。
- **忠実な委譲**: 与えられた指示を忠実に背後の API/CLI へ変換し、結果を構造化データ（`Artifact` または `Message`）としてマスターに返却する。
- **自律的フォールバック禁止**: 失敗時に代替プラグインを選び直す、プロンプトを自動改変するといった行為を禁止する。3 回の再試行で失敗した場合、ただちに `TASK_STATE_FAILED` に遷移してマスターに判断を委ねる。

## 2. アーキテクチャ概要

### 2.1 レイヤ構造

```text
┌────────────────────────────────────────────────────────────┐
│  Master Agent A  (OpenCode / Another A2A Client)           │
└────────────────────────────────────────────────────────────┘
                     ▲ A2A over HTTP (JSON-RPC 2.0 + SSE)
                     │ + Bearer Auth + AgentCard
┌────────────────────▼───────────────────────────────────────┐
│  src/server/   HTTP Adapter (Hono)                         │
│  ─ JSON-RPC router (message/send, message/stream,          │
│    tasks/get, tasks/cancel)                                │
│  ─ SSE writer / AgentCard endpoint / Bearer auth           │
├────────────────────────────────────────────────────────────┤
│  src/core/     Pure A2A Protocol Layer (外部依存=zodのみ)  │
│  ─ a2a-types.ts     (Zodスキーマ)                          │
│  ─ plugin-interface.ts / registry.ts                       │
│  ─ task-runner.ts   (Retry 3x, FAIL on exhaustion)         │
│  ─ task-store.ts    (InMemory default, pluggable)          │
│  ─ helpers/subprocess.ts  (JSON-Lines stdio共通処理)       │
│  ─ config-loader.ts (Zod検証、envプレースホルダ解決)       │
├────────────────────────────────────────────────────────────┤
│  src/plugins/  CLI-specific Implementations                │
│  ─ gemini-cli-plugin.ts                                    │
│  ─ cursor-cli-plugin.ts  (今後)                            │
│  ─ claude-code-plugin.ts (今後)                            │
└────────────────────────────────────────────────────────────┘
                     ▼ subprocess spawn (JSON-Lines over stdio)
                                    または SDK呼び出し
              ┌──────────────────┐
              │  Actual CLI/SDK  │
              └──────────────────┘
```

### 2.2 ディレクトリ構成

```text
opencode-a2a-core/
├── .devcontainer/
│   └── devcontainer.json
├── .github/
│   └── workflows/ci.yml              # devcontainer内でtest/lint実行
├── docs/
│   └── superpowers/specs/
├── src/
│   ├── core/                          # 純A2Aプロトコル層（外部依存=zodのみ）
│   │   ├── a2a-types.ts               # Zod スキーマ + 型
│   │   ├── plugin-interface.ts        # A2APluginInterface 契約
│   │   ├── registry.ts                # PluginRegistry（静的登録）
│   │   ├── task-runner.ts             # 3回リトライ + FAIL遷移
│   │   ├── task-store.ts              # InMemoryTaskStore（抽象+既定）
│   │   ├── config-loader.ts           # Zod検証 + env プレースホルダ
│   │   ├── errors.ts                  # A2AError 階層
│   │   ├── define-plugin.ts           # defineA2APlugin() ファクトリ
│   │   ├── logger.ts                  # 軽量Logger（pino互換IF）
│   │   └── helpers/
│   │       ├── subprocess.ts          # JSON-Lines stdio 共通ヘルパ
│   │       └── exponential-backoff.ts
│   ├── server/                        # 標準HTTPアダプタ
│   │   ├── http-server.ts             # Hono ルーティング
│   │   ├── jsonrpc-router.ts          # JSON-RPC 2.0 ディスパッチ
│   │   ├── sse-writer.ts              # SSE ストリーム出力
│   │   ├── agent-card.ts              # .well-known/agent.json
│   │   ├── auth.ts                    # Bearer トークン検証
│   │   └── cli.ts                     # スタンドアローン起動エントリ
│   ├── plugins/
│   │   └── gemini-cli-plugin.ts       # 実装例
│   └── index.ts                       # 公開APIエントリ
├── tests/
│   ├── core/                          # Vitest ユニットテスト
│   └── integration/                   # サブプロセスモック統合テスト
├── package.json                       # pnpm、Node.js 22, vitest, hono, zod
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.cjs
└── README.md
```

### 2.3 モジュール境界ルール

- `src/core/` は `zod` 以外の外部依存を持たない（純プロトコル層）。
- `src/server/` は `src/core/` を使う。逆は禁止（循環禁止）。
- `src/plugins/` は `src/core/` のみを使う。`src/server/` には触れない。
- プラグイン同士の直接依存は禁止（`registry` 経由のみ）。

## 3. コア契約

### 3.1 `src/core/a2a-types.ts` — Zod スキーマ

A2A v1.0.0 のサブセットを Zod で定義する。`XxxSchema` としてスキーマをエクスポートし、`z.infer` で抽出した型を `Xxx` として併せてエクスポートする。

主要型:

- `PartSchema` — `TextPart | FilePart | DataPart` の判別共用体（`kind` フィールドでタグ付け）。
- `MessageSchema` — `{ role: "ROLE_USER" | "ROLE_AGENT", parts: Part[], messageId?, taskId? }`。
- `TaskStateSchema` — `enum(["TASK_STATE_PENDING", "TASK_STATE_WORKING", "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED"])`。プロンプト記載の 4 状態に `CANCELED` を加え、`tasks/cancel` に対応する。
- `TaskStatusSchema` — `{ state, timestamp?, message? }`。`message` は失敗理由の自由記述。
- `ArtifactSchema` — `{ artifactId: string, parts: Part[], name?, description? }`。
- `TaskSchema` — `{ id: string, contextId?, status: TaskStatus, artifacts?, history? }`。
- `StreamResponseSchema` — 判別共用体。`kind: "task" | "message" | "status-update" | "artifact-update"`。プロンプトの optional フィールド型表記よりも安全。

バージョン定数 `A2A_PROTOCOL_VERSION = "1.0.0"` を同ファイルで定義。

### 3.2 `src/core/plugin-interface.ts` — プラグイン契約

```ts
export interface A2APluginContext {
  logger: Logger;
  abortSignal: AbortSignal;
  taskId: string;
  contextId?: string;
}

export interface A2APluginSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

export interface A2APluginInterface<TConfig = unknown> {
  readonly id: string;
  readonly version: string;
  readonly configSchema: z.ZodType<TConfig>;

  initialize(config: TConfig): Promise<void>;
  dispose(): Promise<void>;

  execute(
    message: Message,
    ctx: A2APluginContext,
  ): AsyncIterable<StreamResponse>;

  metadata(): { skill: A2APluginSkill };
}
```

- プラグインは `configSchema` で自身の設定を自己宣言する。`ConfigLoader` がこれを組み合わせる。
- `execute` は常に `AsyncIterable<StreamResponse>` を返す。同期的用途はイテレータ 1 件で表現する。
- `AbortSignal` によって `tasks/cancel` をサブプロセス等に伝搬する責務はプラグインにある。
- `metadata()` は AgentCard の `skills` 生成に用いる。

### 3.3 `src/core/define-plugin.ts` — サードパーティ契約

```ts
export function defineA2APlugin<TConfig>(
  def: A2APluginInterface<TConfig>,
): A2APluginInterface<TConfig> {
  return def;
}
```

サードパーティは `@yohi/opencode-a2a-plugin-<name>` 等のパッケージで `defineA2APlugin({...})` をデフォルトエクスポートする規約。本関数は将来の互換ヘッダ注入ポイントを確保する。

### 3.4 `src/core/registry.ts` — 静的レジストリ

```ts
export class PluginRegistry {
  private plugins = new Map<string, A2APluginInterface>();
  register(plugin: A2APluginInterface): void;        // 重複idでError
  get(id: string): A2APluginInterface | undefined;
  list(): A2APluginInterface[];
  async initializeAll(configs: Record<string, unknown>): Promise<void>;
  async disposeAll(): Promise<void>;
}
```

起動時に `registry.register(new GeminiCliPlugin())` で登録し、`initializeAll(configs)` で各プラグインへ Zod 検証済み設定を注入する。

## 4. TaskRunner と再試行セマンティクス

### 4.1 責務

`TaskRunner` は A2A における「タスク 1 件のライフサイクル管理」を一元化する。プラグイン実行のオーケストレーション、再試行、状態遷移、タスクストアへの書き込み、ストリームのファンアウトを担う。

### 4.2 主要シグネチャ

```ts
export class TaskRunner {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly taskStore: TaskStore,
    private readonly options: {
      maxAttempts: number;           // 既定 3
      initialBackoffMs: number;      // 既定 500
      backoffMultiplier: number;     // 既定 2
      jitterRatio: number;           // 既定 0.2
      logger: Logger;
    },
  ) {}

  async *run(
    pluginId: string,
    message: Message,
    opts: { abortSignal: AbortSignal; contextId?: string },
  ): AsyncIterable<StreamResponse>;
}
```

戻り値は `AsyncIterable<StreamResponse>`。サーバ層はこのイテレータを SSE にそのまま流す。

### 4.3 再試行ポリシー

1. 試行回数上限は **3 回**（最初の試行を含む。再試行は 2 回まで）。
2. バックオフは指数 + ジッター: `backoff_n = initialBackoff * (multiplier ^ (n - 1)) * (1 ± jitter)`。
3. 再試行対象は「プラグイン初期化段階のエラー」「ストリーム開始前のエラー」のみ。**ストリームが 1 件でも yield された後のエラーは再試行しない**（冪等性を担保できないため）。
4. `AbortSignal` が発火した時点で即座に再試行ループを抜け、タスク状態を `TASK_STATE_CANCELED` に遷移する。
5. 3 回の試行が全て失敗した場合:
   - **自律的フォールバックを一切行わない**（代替プラグイン選択、プロンプト改変等は禁止）。
   - タスク状態を `TASK_STATE_FAILED` に遷移し、`TaskStatus.message` にエラー詳細を設定。
   - `StreamResponse(kind="status-update", status=FAILED)` を yield し、制御をマスターに即返却。
6. 存在しない `pluginId` 等「リトライ不可能なエラー」は `NonRetriableError` として 1 回目で FAILED へ直行する。

### 4.4 タスク状態遷移

```text
   [create]
      │
      ▼
 ┌───────────┐ first-yield  ┌───────────┐
 │  PENDING  │─────────────▶│  WORKING  │
 └─────┬─────┘              └─────┬─────┘
       │                          │
       │    (3回失敗)             │ (stream完了)
       │◀─────────┐               ▼
       │          │         ┌───────────┐
       ▼          │         │ COMPLETED │
 ┌───────────┐    │         └───────────┘
 │  FAILED   │    │
 └───────────┘    │  abort
                  │    │
              ┌───▼────▼──┐
              │ CANCELED  │
              └───────────┘
```

### 4.5 実行フロー（擬似コード）

```text
async *run(pluginId, message, { abortSignal, contextId }) {
  const plugin = registry.get(pluginId) ?? throw NonRetriableError("PluginNotFound")
  const task = await taskStore.create({ contextId })
  yield { kind: "task", task }

  let lastError: unknown
  let firstYield = true
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    if (abortSignal.aborted) {
      await markCanceled(task)
      yield { kind: "status-update", status: CANCELED }
      return
    }
    try {
      for await (const chunk of plugin.execute(message, { taskId: task.id, contextId, abortSignal, logger })) {
        if (firstYield) {
          firstYield = false
          await taskStore.update(task.id, { status: WORKING })
          yield { kind: "status-update", status: WORKING }
        }
        yield chunk
        await taskStore.appendStreamChunk(task.id, chunk)
      }
      await taskStore.update(task.id, { status: COMPLETED })
      yield { kind: "status-update", status: COMPLETED }
      return
    } catch (err) {
      if (!firstYield) { /* ストリーム途中失敗は即 FAILED へ */
        break
      }
      if (err instanceof NonRetriableError) { lastError = err; break }
      lastError = err
      if (attempt < options.maxAttempts) {
        await sleep(backoff(attempt, options))
      }
    }
  }

  const status = { state: FAILED, message: serializeError(lastError), timestamp: now() }
  await taskStore.update(task.id, { status })
  yield { kind: "status-update", status }
}
```

### 4.6 ロギング方針

- 各試行ごとに `{ taskId, pluginId, attempt, backoffMs }` を構造化ログ出力。
- 最終失敗時は `lastError` のスタックトレースを `ERROR` レベルで 1 件出力。情報はタスクステータスの `message` にも反映。
- 軽量 `Logger` を `src/core/logger.ts` で提供し、後日 `pino` 等に差し替え可能なインターフェースとする。

## 5. HTTP サーバ・SSE・AgentCard・認証

### 5.1 エンドポイント

| Method | Path | 役割 |
| --- | --- | --- |
| `GET` | `/.well-known/agent.json` | AgentCard（能力発見、無認証） |
| `GET` | `/health` | ヘルスチェック（無認証） |
| `POST` | `/` | JSON-RPC 2.0 エンドポイント（Bearer 必須） |

A2A v1.0.0 仕様に従い、全ての業務メソッドは単一の `POST /` に JSON-RPC で相乗りする。

### 5.2 JSON-RPC メソッド

| メソッド | 入力 | 出力 | 備考 |
| --- | --- | --- | --- |
| `message/send` | `{ message }` | `Task \| Message` | 完了まで待機して最終結果返却 |
| `message/stream` | `{ message }` | SSE ストリーム | `StreamResponse` を 1 チャンク 1 SSE イベントとして配信 |
| `tasks/get` | `{ id }` | `Task` | `TaskStore` 参照 |
| `tasks/cancel` | `{ id }` | `Task` | 該当タスクの `AbortController.abort()` |

`message/send` は内部で `TaskRunner.run()` を回し、全チャンクを集約して最終 `Task` を返す。

### 5.3 SSE 転送仕様

- `Content-Type: text/event-stream`
- 各チャンクは `event: <kind>\ndata: <json>\n\n` 形式。
- `event` 値: `task` / `message` / `status-update` / `artifact-update` / `error`。
- 完了時に `event: done\ndata: {}\n\n` を送って明示的にクローズ（クライアントのハング防止）。
- SSE 開始前のエラーは JSON-RPC error レスポンスとして返す。SSE 開始後のエラーは `event: error` で流してからクローズ。

### 5.4 タスクキャンセル伝搬

```text
Client → tasks/cancel(id)
  ↓
JSON-RPC router → abortControllerMap.get(id).abort()
  ↓
TaskRunner.run() の abortSignal が発火
  ↓
plugin.execute() 内の abortSignal も発火（ctx経由で伝搬）
  ↓
サブプロセスヘルパが child.kill() で停止
  ↓
TaskRunner が CANCELED 状態を yield して終了
```

`abortControllerMap: Map<taskId, AbortController>` はサーバ層が保持し、`TaskRunner.run()` 開始時に `set`、終了時に `delete`。

### 5.5 AgentCard

```json
{
  "name": "opencode-a2a-core",
  "description": "Thin wrapper agent delegating to CLI backends",
  "version": "0.1.0",
  "protocolVersion": "1.0.0",
  "url": "https://<host>/",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [
    { "id": "gemini-cli", "name": "Gemini CLI", "description": "Delegates to Google Gemini CLI", "tags": ["code", "chat"] }
  ],
  "securitySchemes": { "bearer": { "type": "http", "scheme": "bearer" } },
  "security": [{ "bearer": [] }]
}
```

`skills` は `PluginRegistry.list()` から動的生成する。`url` は設定から注入する（既定で `process.env.PUBLIC_URL`）。

### 5.6 Bearer 認証

- 起動時に受け取るトークン（単一または配列）と `Authorization: Bearer <token>` を比較。
- タイミング攻撃対策として `crypto.timingSafeEqual` を使用。
- `/health` と `/.well-known/agent.json` は認証除外。

### 5.7 サーバ起動エントリ

```ts
// src/server/cli.ts
import { createServer } from "./index.js";
import { GeminiCliPlugin } from "../plugins/gemini-cli-plugin.js";

const server = await createServer({
  plugins: [new GeminiCliPlugin()],
  config: await loadConfig("./opencode-a2a.config.json"),
  auth: { tokens: [process.env.A2A_BEARER_TOKEN!] },
});
await server.listen(3000);
```

## 6. プラグイン実装例と TaskStore

### 6.1 `src/core/task-store.ts`

```ts
export interface TaskStore {
  create(init: { contextId?: string }): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  update(id: string, patch: Partial<Task>): Promise<Task>;
  appendArtifact(id: string, artifact: Artifact): Promise<void>;
  appendStreamChunk(id: string, chunk: StreamResponse): Promise<void>;
  appendHistoryEntry(id: string, status: TaskStatus): Promise<void>;
  delete(id: string): Promise<void>;
}

export class InMemoryTaskStore implements TaskStore { /* Map<string, Task> */ }
```

- 既定は `InMemoryTaskStore`。将来 `SqliteTaskStore` や `RedisTaskStore` に差し替え可能。
- タスク ID は `crypto.randomUUID()` 生成。
- TTL ベースの自動 GC は初期実装では省略（YAGNI）。

### 6.2 `src/core/helpers/subprocess.ts`

```ts
export interface JsonLinesSubprocessOpts {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  abortSignal: AbortSignal;
  stdin?: string | Uint8Array;
  timeoutMs?: number;
}

export async function* runJsonLinesSubprocess(
  opts: JsonLinesSubprocessOpts,
): AsyncIterable<unknown>;
```

責務:

- `child_process.spawn` でプロセス起動。
- stdout を `readline` で行区切り → 各行 `JSON.parse` → `AsyncIterable` に yield。
- `abortSignal` 発火時に `child.kill('SIGTERM')` → 5 秒後 `SIGKILL`。
- プロセス異常終了（`exitCode !== 0`）は `SubprocessError(exitCode, stderr)` をスロー。
- `stdin` 指定時は起動時に書き込んでクローズ。
- `timeoutMs` 無指定は長時間実行を許容。

### 6.3 `src/plugins/gemini-cli-plugin.ts`

```ts
const GeminiConfigSchema = z.object({
  cliPath: z.string().default("gemini"),
  model: z.string().default("gemini-2.5-pro"),
  workingDir: z.string().optional(),
  apiKey: z.string().optional(),
});

export class GeminiCliPlugin implements A2APluginInterface<GeminiConfig> {
  readonly id = "gemini-cli";
  readonly version = "0.1.0";
  readonly configSchema = GeminiConfigSchema;

  private config!: GeminiConfig;

  async initialize(config: GeminiConfig): Promise<void> {
    this.config = config;
    // gemini --version 実行で存在確認（失敗時は TaskRunner がリトライ）
  }

  async dispose(): Promise<void> {}

  async *execute(message: Message, ctx: A2APluginContext): AsyncIterable<StreamResponse> {
    const prompt = this.messageToPrompt(message);
    const proc = runJsonLinesSubprocess({
      cmd: this.config.cliPath,
      args: ["--json", "--model", this.config.model, "-"],
      cwd: this.config.workingDir,
      env: this.config.apiKey ? { GEMINI_API_KEY: this.config.apiKey } : {},
      abortSignal: ctx.abortSignal,
      stdin: prompt,
    });
    for await (const line of proc) {
      const evt = this.parseGeminiEvent(line);
      if (evt) yield evt;
    }
  }

  metadata() {
    return {
      skill: {
        id: "gemini-cli",
        name: "Gemini CLI",
        description: "Delegates to Google Gemini CLI",
        tags: ["code", "chat", "search"],
        examples: ["Generate a React component", "Summarize this file"],
      },
    };
  }

  private messageToPrompt(m: Message): string { /* Part[] → string */ }
  private parseGeminiEvent(raw: unknown): StreamResponse | null {
    // CLI固有イベント → A2A StreamResponse 変換
    // "thinking" は yield せず、ログのみ（ヘッドレス原則）
  }
}
```

規範:

1. `messageToPrompt` はプラグイン固有の責務。CLI が理解できる形式への変換はプラグインが行う。
2. CLI 固有イベント → `StreamResponse` 変換表を `parseGeminiEvent` に閉じ込め、コアに漏らさない。
3. 内部推論（`thinking` 等）は yield せずログのみ（Semantic Drift 回避）。
4. エラーは throw のみ。リトライ可否判断は `TaskRunner` 側の責任。
5. `initialize` で永続的エラー（API キー不在等）は `NonRetriableError` を投げる。一時的エラーは通常スローで TaskRunner のリトライに委ねる。

### 6.4 ConfigLoader の統合

```text
opencode-a2a.config.json  ─┐
                           ├─▶ ConfigLoader (Zod + env解決)
process.env  ──────────────┘         │
                                     ▼
                      Record<pluginId, pluginConfig>
                                     │
                                     ▼
                     registry.initializeAll(configs)
                                     │
                                     ▼
                   各Plugin.initialize(自分の設定)
```

各プラグインの `configSchema` は `ConfigLoader` が `pluginId` キーで参照する。スキーマ未登録のキーが設定ファイルにあれば警告のみ（エラーにはしない、前方互換）。

## 7. Devcontainer

```json
{
  "name": "opencode-a2a-core",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm",
  "features": {
    "ghcr.io/devcontainers/features/common-utils:2": {},
    "ghcr.io/devcontainers/features/git:1": {}
  },
  "postCreateCommand": "corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "vitest.explorer"
      ],
      "settings": {
        "typescript.tsdk": "node_modules/typescript/lib",
        "editor.formatOnSave": true
      }
    }
  },
  "containerEnv": { "NODE_ENV": "development" },
  "remoteUser": "node",
  "mounts": [],
  "forwardPorts": [3000]
}
```

設計上のポイント:

- Node 22 LTS 固定。
- `corepack` 経由で pnpm を固定（グローバル汚染を避ける）。
- `frozen-lockfile` により環境再現性を担保。
- ホスト絶対パスを一切含めない（ユーザ配布上の必須要件）。
- `mounts` を空にし `remoteUser: node` で最小権限。

## 8. テスト戦略

| 階層 | 対象 | カバレッジ目標 |
| --- | --- | --- |
| ユニット | `a2a-types.ts`、`task-runner.ts`、`registry.ts`、`config-loader.ts`、`subprocess.ts`（モック `spawn`） | 主要分岐 95%+ |
| 統合 | `http-server.ts` のエンドポイント、SSE 応答、AgentCard、Bearer 拒否、`tasks/cancel` 伝搬 | 全エンドポイント |
| E2E（任意） | `gemini-cli-plugin.ts` をダミー CLI（`echo`/`jq` 等）で模して実行 | ハッピーパスのみ |

`TaskRunner` は表駆動テストで状態遷移を網羅:

- 0 回目成功 → `COMPLETED`。
- 1 回目失敗 → 2 回目成功 → `COMPLETED`（バックオフ待機検証）。
- 3 回連続失敗 → `FAILED`（`lastError` が `status.message` に含まれる）。
- yield 後に失敗 → `FAILED`（リトライしない）。
- `abortSignal` 即発火 → `CANCELED`（実行前）。
- yield 途中で abort → `CANCELED`。
- 存在しない `pluginId` → `FAILED`（リトライしない）。

`vi.useFakeTimers()` でバックオフを仮想時間化する。

## 9. CI（devcontainer 内テスト強制）

`.github/workflows/ci.yml` 骨子:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: devcontainers/ci@v0.3
        with:
          runCmd: |
            pnpm lint
            pnpm typecheck
            pnpm test --coverage
```

`devcontainers/ci` により、ローカルと CI で同一イメージを使用する。「ローカルでは通るが CI で落ちる」を構造的に防ぐ。

## 10. `package.json` 主要スクリプト

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsx watch src/server/cli.ts",
    "start": "node dist/server/cli.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "typecheck": "tsc --noEmit",
    "prepare": "husky install"
  },
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@9"
}
```

## 11. 成果物

最終納品で完全版コードを提示するファイル（プロンプトの `output_format` 準拠）:

1. アーキテクチャ概要とディレクトリ構成（本書 §2）。
2. `src/core/a2a-types.ts`。
3. `src/core/plugin-interface.ts`。
4. `src/core/task-runner.ts`。
5. `src/plugins/gemini-cli-plugin.ts`。
6. `.devcontainer/devcontainer.json`。

他ファイル（`registry.ts`, `task-store.ts`, `server/*`, `package.json`, `tsconfig.json`, `vitest.config.ts`）はディレクトリツリーとしては言及するが、実コードは初期納品スコープ外とする。

## 12. 残余リスクと緩和策

| リスク | 緩和策 |
| --- | --- |
| サブプロセスのゾンビ化 | `AbortSignal` で `SIGTERM` → 5 秒後 `SIGKILL`、親プロセス終了時も `detached: false` |
| SSE 接続の長時間保持によるソケット枯渇 | Hono のストリーム完了ハンドラで確実にクローズ、`done` イベント送出 |
| プラグイン初期化時のシークレット露出 | ログフォーマッタで `apiKey` 等キー名を自動マスク |
| A2A v1.0.0 仕様の今後の変更 | `A2A_PROTOCOL_VERSION` 定数で明示、AgentCard にも記載 |
| ストリーム途中失敗の冪等性問題 | 設計上「yield 後の失敗はリトライしない」ことを TaskRunner が強制 |

## 13. 設計上の主要判断サマリ

| 判断事項 | 決定 | 根拠 |
| --- | --- | --- |
| 形態 | ハイブリッド（ライブラリ + 標準 HTTP サーバ同梱） | コアの再利用性を保ちつつ単独起動も可能に |
| プラグインロード | 静的レジストリ + `defineA2APlugin()` 公開契約 | 型安全・デバッグ容易、将来のサードパーティ拡張にも対応 |
| CLI 呼び出しモデル | 抽象 IF + `src/core/helpers/subprocess.ts` 共通ヘルパ | コアが特定通信モデルに縛られない、DRY も両立 |
| ランタイム | Node.js 22 + pnpm + Vitest | エコシステム互換性・再現性最優先 |
| HTTP 実装 | Hono + JSON-RPC 2.0 + SSE + AgentCard + Bearer | A2A v1.0.0 準拠、依存を最小化 |
| 設定注入 | プログラマティック + `ConfigLoader`（JSON + env プレースホルダ） | ライブラリ利用とスタンドアローン利用の両立 |
| タスク永続化 | `InMemoryTaskStore` 既定 + `TaskStore` 抽象 | 薄いラッパー用途に十分、拡張余地を残す |
| `TaskState` 拡張 | `CANCELED` を追加（計 5 状態） | `tasks/cancel` 対応に必須 |
| `StreamResponse` 表現 | `kind` による判別共用体 | 型安全性・ランタイム検証のしやすさ |
