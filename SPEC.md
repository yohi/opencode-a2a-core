# opencode-a2a-core 仕様書 (SPEC)

## 1. 概要
`opencode-a2a-core` は A2A (Agent-to-Agent) プロトコル通信のコアフレームワークです。
マスターエージェントからの指示を受け、薄いラッパーとして動作する「実行エージェント」を構築するための基盤を提供します。

## 2. アーキテクチャ

システムは以下の層に分かれています：
- **コア層 (`src/core/`)**: Zodによる型定義、プラグインインターフェース、タスクランナー (`TaskRunner`)、タスクストア (`TaskStore`)、設定ローダなど、A2Aプロトコルの純粋な実装を提供します。外部依存は `zod` のみです。
- **プラグイン層 (`src/plugins/`)**: 実際のCLIやAPIとの連携を担います。例として Gemini CLI 連携プラグイン (`GeminiCliPlugin`) が実装されています。

## 3. A2A 型定義 (`src/core/a2a-types.ts`)

A2A v1.0.0 をベースにしつつ、本実装に合わせて拡張されています。
- `A2A_PROTOCOL_VERSION`: `1.0.0`
- **`TaskState`**:
  - `TASK_STATE_PENDING`
  - `TASK_STATE_SUBMITTED`
  - `TASK_STATE_WORKING`
  - `TASK_STATE_INPUT_REQUIRED`
  - `TASK_STATE_COMPLETED`
  - `TASK_STATE_FAILED`
  - `TASK_STATE_CANCELED`
  - `TASK_STATE_UNKNOWN`
- **`TaskStatus`**: `{ state, timestamp?, message? }`。`message` はエラー詳細などを保持する `Message` オブジェクトとして扱われます。
- **`Task`**: タスクの実行状態を管理します。ステータスの遷移履歴は `statusHistory`、エージェントからのメッセージ（ログなど）は `history` に保存されます。
- **`StreamResponse`**: プラグインの実行結果などをストリーミングするための判別共用体。`task`, `message`, `status-update`, `artifact-update` の種類があります。

## 4. プラグイン仕様 (`src/core/plugin-interface.ts`)

プラグインは `A2APluginInterface` を実装します。
- **必須プロパティ / メソッド**:
  - `id`: プラグインの一意識別子
  - `version`: バージョン
  - `execute`: 実行処理を行い `AsyncIterable<StreamResponse>` を返します。
  - `metadata`: プラグインのスキル情報を提供します。
- **任意プロパティ / メソッド**:
  - `initialize`: 設定の初期化処理を行います。
  - `dispose`: リソースのクリーンアップを行います。
  - `configSchema`: Zod スキーマで設定の型を定義できます。

プラグインは `PluginRegistry` を通じて管理され、初期化時にスキーマベースの検証が行われます。初期化に失敗した場合、安全のため既に初期化されたプラグインの `dispose` を呼んでロールバックする機構を備えています。

## 5. TaskRunner と再試行制御

`TaskRunner` はタスクのライフサイクルを管理し、エラー時のリトライ制御を担います。
- **リトライポリシー**:
  - 失敗時には、指数バックオフ (Exponential Backoff + Jitter) に基づいて最大 `maxAttempts` 回まで再試行します。
  - `maxBackoffMs` オプションにより、バックオフの上限時間を制限できます。
  - 既にストリーム (`artifact-update` など) が発生した後のエラーは再試行しません（冪等性担保のため）。
  - `NonRetriableError` が投げられた場合や、プラグインが存在しない場合はリトライせずに即座に終了となります。
- **エラーハンドリング**:
  - 最終的にリトライ上限に達した場合、あるいはリトライ不可能なエラーが発生した場合、タスクの状態を `TASK_STATE_FAILED` としてイベントを発行（yield）した上で、最後のエラーをスロー(`throw`)します。これにより呼び出し元（サーバー層等）で確実な例外ハンドリングが可能になります。

## 6. TaskStore と状態永続化

タスクの状態や生成物は `TaskStore` インターフェースを通じて管理されます。
- 既定の実装として `InMemoryTaskStore` が提供されています。
- ミューテーション（意図しない状態変更によるバグ）を防ぐため、内部データの保存・取得時には `structuredClone` によるディープコピーが徹底されています。
- `StreamResponse` のチャンクを受信すると、種類に応じて自動的にタスクデータの `artifacts` や `statusHistory`、`history` へ安全に追記されます。

## 7. 今後の拡張 (HTTP サーバー層 / Server Adapter)

次のフェーズとして、本コア基盤をラップする標準 HTTP サーバーアダプタ (`src/server/`) の実装が計画されています。

### 予定される機能
- **HTTP サーバーの実装 (Hono ベース)**:
  - `Hono` を使用して、コア層（`TaskRunner` など）をラップする HTTP アダプタを作成する。
- **JSON-RPC 2.0 エンドポイント (`POST /`)**:
  - A2A v1.0.0 仕様に準拠し、以下のメソッドを提供する：
    - `message/send`: タスクの生成・完了待機
    - `message/stream`: SSEによるストリーミング応答
    - `tasks/get`: タスク状態の取得
    - `tasks/cancel`: AbortController を介したタスクのキャンセル
- **SSE (Server-Sent Events) 対応**:
  - `TaskRunner` が返す `AsyncIterable<StreamResponse>` を SSE 形式 (`event: <kind>`, `data: <json>`) でクライアントにストリーム配信する。
- **AgentCard (`GET /.well-known/agent.json`)**:
  - プラグインのメタデータ（対応スキルなど）を集約して、エージェントの能力を公開するエンドポイント。
- **Bearer 認証**:
  - 起動時に設定されたトークンを用いて認証を行う。タイミング攻撃対策として `crypto.timingSafeEqual` を用いた固定長バッファでのセキュアな比較を実施する。

