# A2A Thin Wrapper Modernization Design (Final v2)

## Purpose
Gemini CLIのA2A（Agent-to-Agent）実装は、コアアーキテクチャの進化（`AgentLoopContext`によるDIや新しいツールレジストリ）から取り残されており、クライアント側の`Config`オブジェクトへの密結合や、サーバー側での`TaskWrapper`および状態永続化レイヤの二重管理といった技術的負債を抱えています。
本プロジェクトは、A2Aが本来意図していた「極薄のラッパー（Thin Wrapper）」という基本設計思想に立ち返り、クライアント側とサーバー側の両方を最新のコアアーキテクチャに準拠させることを目的とします。

## Scope
クライアント側（Phase 1）とサーバー側（Phase 2）の改修は独立しており、個別のPRとして段階的に導入可能です。
* **Client-side (Phase 1)**: `A2AClientManager` および `RemoteSubagentProtocol` のDI化。
* **Server-side (Phase 2)**: `a2a-server` 内 `TaskWrapper` および独自の状態管理の廃止、標準コアへの直接委譲への再設計。

### Non-Goals
* A2Aプロトコルの仕様そのものの変更や拡張。
* MCP（Model Context Protocol）など、他のエージェントプロトコルの実装変更。

## Architecture & Design

### Phase 1: クライアント側の再設計 (Client-Side Redesign)
* **A2AClientManagerの純粋なサービス化**:
  コンストラクタ引数から `Config` 型を完全に排除し、`{ proxy?: string, fetch?: typeof fetch, authProviderFactory: A2AAuthProviderFactory }` を注入する形へ刷新します。
  * **Migration Path**: `Config` 側で `A2AClientManager` を初期化する際、プロキシ設定等を渡します。認証不要なケースでは `NoopAuthProviderFactory` を渡す構成とし、APIの単純性を維持します。`loadAgent(authHandler)` の API は維持し、既存コンシューマとの互換性を保ちます。

### Phase 2: サーバー側の再設計 (Server-Side Redesign)
* **Thin Router への刷新**:
  `A2A Request` → `Thin Router`（Context構築） → `LocalAgentExecutor`（コア実行） → `Event Adapter`（レスポンス成形） → `A2A Response` というクリーンなパイプラインを構築します。
  * **Adapterの責務**: `LocalAgentExecutor` からの標準イベントを A2A 互換の `CoderAgentEvent` ストリームに変換し、外部クライアントへの破壊的変更を防止します。
* **専用AgentDefinitionの策定**:
  `packages/core/src/agents/coder-agent-definition.ts` を新設します。
  * **Termination**: エージェントが `complete_task` を呼び出した時点で A2A タスクを完了状態（`completed`）とし、結果を返却します。

## Backward Compatibility & Persistence Migration
* **Persistence Migration**:
  Thin Wrapper思想を優先し、Phase 2 導入時に**既存の `PersistedStateMetadata` ベースのタスクは非互換（Drop）として扱います**。
* **Cancellation Semantics**:
  `A2A cancelTask RPC` → `Routerの AbortController.abort()` → `LocalAgentExecutorの signal` という経路で、標準のツール実行中断フローへ確実にブリッジします。

## Risks
* **既存タスクのロスト**: Phase 2 デプロイ時、実行中の永続化タスクが失われる。
  - Mitigation: メンテナンスウィンドウの告知、低トラフィック時間帯のデプロイ、事前のドレイン手順の策定。
* **Event Adapter の不完全性**: `GeminiEventType` → `CoderAgentEvent` 変換の漏れによる、既存クライアントへの影響。
  - Mitigation: Adapter層のスナップショットテストを導入し、現行ストリーム形状との互換性を固定。
* **キャンセル伝播の取りこぼし**: `AbortSignal` が特定のツール実行経路で無視される可能性。
  - Mitigation: `race-condition.test.ts` を Adapter 経由で実行し、キャンセル意味論の維持を確認。

## Success Criteria & Verification
1. **Client-side (Phase 1)**: 
   * `A2AClientManager` のコンストラクタから `Config` 依存が消滅していること。
   * `a2a-client-manager.test.ts` がパスすること。
2. **Server-side (Phase 2)**: 
   * `TaskWrapper` および独自の状態管理コードが削除されること。
   * Event Adapter の単体テスト（変換ロジック）が追加されパスすること。
   * `a2a-server/src/agent/*.test.ts` (全件) がパスすること。
3. **Verification Command**:
   * `pnpm -F @google/gemini-cli-a2a-server test`
   * `pnpm -F @google/gemini-cli-core test -- src/agents/a2a-client-manager.test.ts`
