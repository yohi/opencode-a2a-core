# A2A Thin Wrapper Modernization Design

## Purpose
Gemini CLIのA2A（Agent-to-Agent）実装は現在、コアアーキテクチャの進化（`AgentLoopContext`によるDIや新しいツールレジストリ）から取り残されており、`Config`オブジェクトへの密結合やサーバー側での独自実行ループの重複といった技術的負債を抱えています。
本プロジェクトは、A2Aが本来意図していた「極薄のラッパー（Thin Wrapper）」という基本設計思想に立ち返り、クライアント側とサーバー側の両方を最新のコアアーキテクチャに準拠させることを目的とします。

## Scope
* **Client-side**: `A2AClientManager` および `RemoteSubagentProtocol` のDI化。
* **Server-side**: `a2a-server` 内の独自実行ループ（`CoderAgentExecutor`）の廃止と、標準コア（`LocalAgentExecutor`等）への直接委譲への再設計。

## Architecture & Design

### 1. クライアント側の再設計 (Client-Side Redesign)
* **A2AClientManagerの純粋なサービス化**:
  現在コンストラクタで巨大な`Config`オブジェクトを受け取っている部分を廃止します。代わりに、プロキシ設定やフェッチ関数などの必要な通信依存、および認証プロバイダをコンストラクタ注入（DI）で受け取るようにし、A2A通信を担う純粋なクライアント層として独立させます。
* **RemoteSubagentProtocolの連携強化**:
  A2Aを呼び出す`RemoteSubagentProtocol`側において、最新の`AgentLoopContext`を利用して`A2AClientManager`をインスタンス化または取得します。これにより、ローカルのサブエージェント（`LocalAgentExecutor`）と同等のクリーンなライフサイクルとデータフローをリモートエージェントでも確立します。

### 2. サーバー側の再設計 (Server-Side Redesign)
* **独自タスクループの廃止**:
  現在の`a2a-server`は、`CoderAgentExecutor`がツールの呼び出しやタスクの状態管理をマニュアルでループ処理する重厚な実装になっています。これを非推奨・廃止とし、処理の二重管理を解消します。
* **Thin Routerへの刷新**:
  A2Aプロトコルのリクエスト（メッセージの受信）を受け取った際、自身でループを回すのではなく、リクエスト情報から`AgentLoopContext`を構築し、コア標準の`LocalAgentExecutor`（GeneralistAgent等の適切な定義）や`GeminiChat`へそのまま処理を委譲（ストリームパイプ）する「極薄のルーター層」へと再設計します。
  これにより、コア側で実装済みのコンテキスト圧縮機能や安全なツール実行制御がそのまま適用されます。

## Success Criteria
* `A2AClientManager` が `Config` オブジェクトに依存しなくなること。
* `a2a-server` 内の `CoderAgentExecutor` による複雑なカスタムループが削除され、標準のExecutorベースの薄い実装に置き換わること。
* 既存のA2Aプロトコルの結合テスト（ストリーミング、キャンセル、結果の再構築）がパスすること。
