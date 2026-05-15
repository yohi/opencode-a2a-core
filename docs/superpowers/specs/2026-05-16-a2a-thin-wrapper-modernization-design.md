# A2A Thin Wrapper Modernization Design

## Purpose
Gemini CLIのA2A（Agent-to-Agent）実装は、コアアーキテクチャの進化（`AgentLoopContext`によるDIや新しいツールレジストリ）から取り残されており、クライアント側の`Config`オブジェクトへの密結合や、サーバー側での`TaskWrapper`および状態永続化レイヤの二重管理といった技術的負債を抱えています。
本プロジェクトは、A2Aが本来意図していた「極薄のラッパー（Thin Wrapper）」という基本設計思想に立ち返り、クライアント側とサーバー側の両方を最新のコアアーキテクチャに準拠させることを目的とします。

## Scope
クライアント側（Phase 1）とサーバー側（Phase 2）の改修は独立しており、個別のPRとして段階的に導入（マージ）可能です。
* **Client-side (Phase 1)**: `A2AClientManager` および `RemoteSubagentProtocol` のDI化。
* **Server-side (Phase 2)**: `a2a-server` 内の `TaskWrapper` および独自の状態管理の廃止、標準コア（`LocalAgentExecutor`等）への直接委譲への再設計。

### Non-Goals
* A2Aプロトコルの仕様そのものの変更や拡張（認証フローの変更など）。
* MCP（Model Context Protocol）など、他のエージェントプロトコルの実装変更。

## Architecture & Design

### Phase 1: クライアント側の再設計 (Client-Side Redesign)
* **A2AClientManagerの純粋なサービス化**:
  現在コンストラクタで巨大な`Config`オブジェクトを受け取っている部分を廃止します。コンストラクタのシグネチャを変更し、`{ proxy?: string, fetch?: typeof fetch, authProviderFactory?: ... }` のような必要最小限の依存のみを注入（DI）する形へリファクタリングします。
  * **Migration Path**: `Config` 側は引き続きプロキシや設定情報を保持し、ファクトリメソッド等を通じて `A2AClientManager` に必要な依存を渡す責務を担います。また、`loadAgent(authHandler)` の API シグネチャは維持し、内部で factory を用いるか呼び出し元から注入するかを整理します。

### Phase 2: サーバー側の再設計 (Server-Side Redesign)
* **二重管理の解消 (TaskWrapper と 永続化)**:
  `a2a-server` は既にコア標準のスケジューラを利用していますが、メタデータの永続化や `TaskWrapper` による状態管理が独自に実装されています。これらを段階的に非推奨化し、標準の `AgentLoopContext` と `LocalAgentExecutor` に委譲する薄いルーター層へと刷新します。
* **アーキテクチャフローの明確化**:
  `A2A Request` → `Thin Router`（AgentLoopContext構築） → `LocalAgentExecutor`（コア実行） → `Event Adapter`（A2Aレスポンス成形） → `A2A Response` という一方向のパイプラインを構築します。
* **専用AgentDefinitionの策定**:
  `packages/a2a-server/src/agent/` 内に専用の `CoderAgentDefinition` を新設します。
  * **Termination Semantics**: A2Aの「終了」シグナルと `LocalAgentExecutor` の `complete_task` フロー間のマッピング方針をここで定義し、エージェントが自律的にタスクを完了するライフサイクルをA2Aのセマンティクスに適合させます。

## Backward Compatibility & Persistence Migration
* **Event Stream Compatibility**:
  `CoderAgentEvent` ストリーム等の外部A2Aクライアントが依存している可能性のある形状は、前述の「Event Adapter」層で維持・吸収します。
* **Cancellation Semantics**:
  現行の `cancelPendingTools` による細粒度キャンセルと `LocalAgentExecutor` のライフサイクルの意味論の違いを吸収するブリッジを実装します。

## Open Questions
* **[Q1] 既存 PersistedStateMetadata のマイグレーション方針**
  * 概要: GCS persistence等で保存されている既存タスクをDropするか、Dual-readアダプターを書くか。
  * 決定期限: Phase 2 着手前
  * 影響: Phase 2 全体の設計と永続化レイヤの改修規模
* **[Q2] 認証プロバイダ DI の境界と設計**
  * 概要: 現行の per-agent `AuthenticationHandler` 渡しと factory 注入の最適な責務分割。
  * 決定期限: Phase 1 着手前

## Risks
* **GCS Persistence 障害**: 永続化レイヤの切り替えにより、既存の実行中タスクがロストするリスク。
* **外部クライアントへの影響**: イベントストリームの微細な形状変更による既存A2Aクライアントの破損。
* **セマンティクス摩擦**: `complete_task` を前提とする最新コアと、外部駆動のA2Aプロトコルとの間でのライフサイクルの不一致。

## Success Criteria & Verification
1. **Client-side (Phase 1)**: 
   * `A2AClientManager` のコンストラクタ引数から `Config` 型が消え、注入される依存が `{ proxy?, fetch?, authProviderFactory? }` 等に明確化されること。
   * `npm run test -w @google/gemini-cli-core -- src/agents/a2a-client-manager.test.ts` がパスすること。
2. **Server-side (Phase 2)**: 
   * `TaskWrapper` および関連する独自状態管理レイヤが削除（または `@deprecated` 指定）されること。
   * `a2a-server/src/agent/*.test.ts` (race-condition や event-driven 含む全件) がパスすること。
3. **Verification Command**:
   * リファクタリング完了後、`npm run test -w @google/gemini-cli-a2a-server` 全体が成功すること。
