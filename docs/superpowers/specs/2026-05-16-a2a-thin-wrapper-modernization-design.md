# A2A Thin Wrapper Modernization Design

## Purpose
Gemini CLIのA2A（Agent-to-Agent）実装は、コアアーキテクチャの進化（`AgentLoopContext`によるDIや新しいツールレジストリ）から取り残されており、クライアント側の`Config`オブジェクトへの密結合や、サーバー側での`TaskWrapper`および状態永続化レイヤの二重管理といった技術的負債を抱えています。
本プロジェクトは、A2Aが本来意図していた「極薄のラッパー（Thin Wrapper）」という基本設計思想に立ち返り、クライアント側とサーバー側の両方を最新のコアアーキテクチャに準拠させることを目的とします。

## Scope
* **Client-side (Phase 1)**: `A2AClientManager` および `RemoteSubagentProtocol` のDI化。
* **Server-side (Phase 2)**: `a2a-server` 内の `TaskWrapper` および独自の状態管理の廃止、標準コア（`LocalAgentExecutor`等）への直接委譲への再設計。

### Non-Goals
* A2Aプロトコルの仕様そのものの変更や拡張（認証フローの変更など）。
* MCP（Model Context Protocol）など、他のエージェントプロトコルの実装変更。

## Architecture & Design

### Phase 1: クライアント側の再設計 (Client-Side Redesign)
* **A2AClientManagerの純粋なサービス化**:
  現在コンストラクタで巨大な`Config`オブジェクトを受け取っている部分を廃止します。コンストラクタのシグネチャを変更し、`{ proxy?: string, fetch?: typeof fetch, authProviderFactory?: ... }` のような必要最小限の依存のみを注入（DI）する形へリファクタリングします。
  * **Migration Path**: `Config` 側は引き続きプロキシや設定情報を保持し、ファクトリメソッド等を通じて `A2AClientManager` に必要な依存を渡す責務を担います。`remote-subagent-protocol.ts` などのコンシューマは、`AgentLoopContext` を介して初期化済みのマネージャーにアクセスします。

### Phase 2: サーバー側の再設計 (Server-Side Redesign)
* **二重管理の解消 (TaskWrapper と 永続化)**:
  `a2a-server` は既にコア標準のスケジューラを利用していますが、メタデータの永続化（`getPersistedState` / `setPersistedState`）や `TaskWrapper` による状態管理が独自に実装されています。これらを段階的に非推奨化し、標準の `AgentLoopContext` と `LocalAgentExecutor` に委譲する薄いルーター層へと刷新します。
* **専用AgentDefinitionの策定**:
  `a2a-server` が受け付けるリクエストを処理するため、`LocalAgentExecutor` に渡す専用の `CoderAgentDefinition` を新設します（既存の `GeneralistAgent` を再利用するのではなく、A2A固有のツールや `complete_task` フローを定義した専用のものを策定）。

## Backward Compatibility & Persistence Migration
* **Persistence Migration (永続化スキーマ)**:
  GCS persistence などで保存されている既存の `PersistedStateMetadata` ベースのタスクは、新しい `LocalAgentExecutor` ベースの実行に切り替えた際に復元不能になるリスクがあります。そのため、既存のタスクの読み込み（Dual-read）をサポートするアダプターを用意するか、破壊的変更として既存タスクをDropするかの移行方針を実装前に最終決定します。
* **Event Stream Compatibility**:
  `CoderAgentEvent.StateAgentSettingsEvent` など、外部の A2A クライアントが依存している可能性のあるストリームの形状は維持し、内部の実装だけを差し替える「アダプター層」をサーバーのレスポンス出力部に設けます。
* **Cancellation Semantics**:
  現行の `CoderAgentExecutor.cancelTask` が提供する `cancelPendingTools` による細粒度キャンセルと、`LocalAgentExecutor` の `complete_task` ベースのライフサイクル間の意味論の違いを吸収するため、キャンセルシグナルの確実な伝播を保証するブリッジを実装します。

## Risks
* **GCS Persistence 障害**: 永続化レイヤの切り替えにより、既存の実行中タスクがロストするリスク。
* **外部クライアントへの影響**: イベントストリームの微妙なタイミング変更や形状変更による、既存の A2A クライアントの破損。

## Success Criteria & Verification
1. **Client-side**: 
   * `A2AClientManager` のコンストラクタ引数から `Config` 型が消え、注入される依存が `{ proxy?, fetch?, authProviderFactory? }` 等に明確化されること。
   * `a2a-client-manager.test.ts` およびその依存テストがすべてパスすること。
2. **Server-side**: 
   * 最終的に `TaskWrapper` および関連する状態永続化の独自実装が削除（または `@deprecated` 指定）されること。
   * `executor.test.ts` および `task.test.ts` がリファクタリング後もパスすること。
3. **Verification Command**:
   * 実装後、`npm run test -w @google/gemini-cli-a2a-server` および `npm run test -w @google/gemini-cli-core -- src/agents/a2a-client-manager.test.ts` が成功すること。
