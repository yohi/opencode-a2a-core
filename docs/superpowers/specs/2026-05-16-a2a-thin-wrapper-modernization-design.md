# A2A Thin Wrapper Modernization Design (Final)

## Purpose
Gemini CLIのA2A（Agent-to-Agent）実装は、コアアーキテクチャの進化（`AgentLoopContext`によるDIや新しいツールレジストリ）から取り残されており、クライアント側の`Config`オブジェクトへの密結合や、サーバー側での`TaskWrapper`および状態永続化レイヤの二重管理といった技術的負債を抱えています。
本プロジェクトは、A2Aが本来意図していた「極薄のラッパー（Thin Wrapper）」という基本設計思想に立ち返り、クライアント側とサーバー側の両方を最新のコアアーキテクチャに準拠させることを目的とします。

## Scope
クライアント側（Phase 1）とサーバー側（Phase 2）の改修は独立しており、個別のPRとして段階的に導入可能です。
* **Client-side (Phase 1)**: `A2AClientManager` および `RemoteSubagentProtocol` のDI化。
* **Server-side (Phase 2)**: `a2a-server` 内の `TaskWrapper` および独自の状態管理の廃止、標準コアへの直接委譲への再設計。

### Non-Goals
* A2Aプロトコルの仕様そのものの変更や拡張。
* MCP（Model Context Protocol）など、他のエージェントプロトコルの実装変更。

## Architecture & Design

### Phase 1: クライアント側の再設計 (Client-Side Redesign)
* **A2AClientManagerの純粋なサービス化**:
  コンストラクタ引数から `Config` 型を完全に排除し、`{ proxy?: string, fetch?: typeof fetch, authProviderFactory: A2AAuthProviderFactory }` を注入する形へ刷新します。
  * **Migration Path**: `Config` 側で `A2AClientManager` を初期化する際、自身のプロキシ設定やグローバルなフェッチ実装を渡します。`loadAgent(authHandler)` の API は維持し、既存のテストコードとの互換性を保ちつつ、内部実装を DI ベースに切り替えます。

### Phase 2: サーバー側の再設計 (Server-Side Redesign)
* **Thin Router への刷新**:
  `A2A Request` → `Thin Router`（Context構築） → `LocalAgentExecutor`（コア実行） → `Event Adapter`（レスポンス成形） → `A2A Response` というクリーンなパイプラインを構築します。
  * **Routerの責務**: A2Aのリクエストから `AgentLoopContext` を構築し、タスクを実行します。
  * **Adapterの責務**: `LocalAgentExecutor` からの標準イベント（`GeminiEventType`等）を A2A 互換の `CoderAgentEvent` ストリームに変換し、外部クライアントへの破壊的変更を防止します。
* **専用AgentDefinitionの策定**:
  `packages/core/src/agents/coder-agent-definition.ts` を新設し、A2Aサーバー向けのツールセットと `complete_task` フローを定義します。これにより、コア側での再利用性とテスト容易性を向上させます。
  * **Termination**: エージェントが `complete_task` を呼び出した時点で A2A タスクを完了状態（`completed`）とし、結果を返却します。

## Backward Compatibility & Persistence Migration
* **Persistence Migration**:
  設計思想（Thin Wrapper）を優先し、Phase 2 導入時に**既存の `PersistedStateMetadata` ベースの実行中タスクは非互換（Drop）として扱います**。APIレベルでの互換性（新しいリクエストの受付）を優先し、複雑な状態移行アダプターによるバグ混入のリスクを回避します。
* **Cancellation Semantics**:
  `LocalAgentExecutor` への `AbortSignal` 伝播を通じて、A2Aプロトコルのキャンセル要求を標準のツール実行中断フローへ確実にブリッジします。

## Success Criteria & Verification
1. **Client-side (Phase 1)**: 
   * `A2AClientManager` のコンストラクタから `Config` 依存が消滅していること。
   * `a2a-client-manager.test.ts` がパスすること。
2. **Server-side (Phase 2)**: 
   * `TaskWrapper` および独自の状態管理コードが削除されること。
   * `a2a-server/src/agent/*.test.ts` (race-condition, event-driven含む全件) がパスすること。
3. **Verification Command**:
   * `npm run test -w @google/gemini-cli-a2a-server`
   * `npm run test -w @google/gemini-cli-core -- src/agents/a2a-client-manager.test.ts`
