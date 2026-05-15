# A2A Thin Wrapper Modernization 実装計画

- **設計書**: [`docs/superpowers/specs/2026-05-16-a2a-thin-wrapper-modernization-design.md`](../specs/2026-05-16-a2a-thin-wrapper-modernization-design.md)
- **作成日**: 2026-05-16
- **対象ブランチ**: `master`（ベース）
- **作業領域**: `gemini-cli/packages/core/src/agents/`、`gemini-cli/packages/a2a-server/src/`

## Purpose
A2A実装をコアアーキテクチャ（`AgentLoopContext` DI、新ツールレジストリ）に追従させ、「Thin Wrapper」思想に立ち返るために、クライアント側とサーバー側を独立した段階で再設計する。

## Git ブランチ運用フロー

本計画は **AI-Native Stacked PR Workflow** に従う:
<https://different-sunday-448.notion.site/AI-Native-Stacked-PR-Workflow-3611669a4c16802eb032eb4ab05a8adb>

### 派生元の判断ルール
- **Baseから派生**: タスクの成果物が単体で完結し、他タスクの未マージ変更に依存しないもの。
- **直前Taskから派生**: 直前タスクの未マージ成果物（型・関数・契約）に依存し、それ無しでビルド/テストが通らないもの。

### Phase ベース集約
- 各 Phase は **Phase Base ブランチ**（例: `phase/1-client`, `phase/2-server`）を持ち、Phase 内の Task PR はそこへスタックする。
- Phase 完了後、Phase Base を `master` へマージする。

### ブランチ命名
- Phase Base: `phase/<N>-<short-name>`
- Task: `task/<phase>-<task>-<slug>` (例: `task/1-1-auth-provider-factory`)

## Constraints（全タスク共通）

- **テスト・静的解析の実行は必ず Devcontainer 内で行う**:
  ```bash
  # ホスト側
  devcontainer exec --workspace-folder . <command>
  # もしくは VSCode Remote Container 起動後にコンテナ内ターミナルで実行
  ```
- **Devcontainer 内コマンド**:
  - Lint: `pnpm lint`
  - Typecheck: `pnpm typecheck`
  - Test: `pnpm test:coverage`
  - パッケージ単位: `pnpm test -F @google/gemini-cli-a2a-server` 等
- **各 Task の最終アクションとして Phase Base に向けた Draft PR を作成する**:
  ```bash
  gh pr create --base phase/<N>-<short> --head task/<...> --draft \
    --title "<conventional commit title>" --body-file .github/PR_BODY.md
  ```

---

## Phase 0: 開発環境・CI 基盤整備

### 目的
- 既存の CI/CD と Devcontainer を本計画の制約（`master` トリガー、`ubuntu-slim` 相当ランナー、Devcontainer 経由テスト）に整合させる。
- 既存ファイルは存在するため、構築ではなく**調整タスク**として扱う。

### Task 0.1: CI ランナーとトリガー調整
- **派生元**: Base (`master`)
- **理由**: 既存 `ci.yml` を変更するのみで自己完結する
- **ブランチ**: `task/0-1-ci-runner-adjust`
- **実装内容**:
  - [ ] `.github/workflows/ci.yml` の `runs-on` を `ubuntu-slim`（自己ホスト or `ubuntu-latest` の slim 等価ランナー）へ変更
  - [ ] トリガーを `master` 中心に整理（`develop` 併用は維持可、要件は `master` 必須）
  - [ ] ジョブ matrix に `pnpm -F @google/gemini-cli-core test` と `pnpm -F @google/gemini-cli-a2a-server test` を分離
- **確認手順** (Devcontainer 内):
  - [ ] `pnpm lint && pnpm typecheck && pnpm test:coverage` がローカル相当で完走
  - [ ] `act -j test`（任意）で GitHub Actions ローカル実行検証
- **最終アクション**:
  - [ ] Phase Base が存在しないため、本タスクは `master` 直行の Draft PR として作成（`gh pr create --base master --draft`）

### Task 0.2: Devcontainer の依存解決確認
- **派生元**: Base (`master`)
- **理由**: 単一の設定ファイル更新で完結
- **ブランチ**: `task/0-2-devcontainer-verify`
- **実装内容**:
  - [ ] `.devcontainer/devcontainer.json` の `postCreateCommand` が `gemini-cli/` サブモジュール配下も含めて `pnpm install --frozen-lockfile` できることを検証
  - [ ] 必要に応じて `features` に `github-cli` を追加（PR 作成用）
- **確認手順** (Devcontainer 内):
  - [ ] コンテナ Rebuild 後 `pnpm install --frozen-lockfile` が成功
  - [ ] `gh --version` が解決される
- **最終アクション**:
  - [ ] Draft PR を `master` 宛に作成

---

## Phase 1: クライアント側の再設計 (Client-Side Redesign)

### 目的
`A2AClientManager` から `Config` 依存を排除し、`{ proxy?, fetch?, authProviderFactory }` の DI 形式へ刷新する。`loadAgent(authHandler)` API は維持。

### Phase Base: `phase/1-client`
- Base ブランチを `master` から作成して PR を空のまま作っておき、各 Task PR がスタックする土台にする。
- [ ] `git switch -c phase/1-client master && git push -u origin phase/1-client`
- [ ] `gh pr create --base master --head phase/1-client --draft --title "feat(a2a-client): Phase 1 base"` 

### Task 1.1: `A2AAuthProviderFactory` 契約と `NoopAuthProviderFactory` 追加
- **派生元**: Phase Base (`phase/1-client`)
- **理由**: 新規型/クラスのみの追加で他コードに影響せず単体完結
- **ブランチ**: `task/1-1-auth-provider-factory`
- **実装内容**:
  - [ ] `gemini-cli/packages/core/src/agents/a2a-auth-provider.ts` に `A2AAuthProviderFactory` インタフェース定義
  - [ ] `NoopAuthProviderFactory` クラス実装（認証不要ケース向け）
  - [ ] 同パスにユニットテスト `a2a-auth-provider.test.ts` を追加（TDD: Red → Green）
- **確認手順** (Devcontainer 内):
  - [ ] `pnpm -F @google/gemini-cli-core test -- a2a-auth-provider`
  - [ ] `pnpm typecheck`
- **最終アクション**:
  - [ ] `gh pr create --base phase/1-client --head task/1-1-auth-provider-factory --draft`

### Task 1.2: `A2AClientManager` コンストラクタ刷新（`Config` 依存排除）
- **派生元**: Task 1.1 (`task/1-1-auth-provider-factory`)
- **理由**: 1.1 で導入する `A2AAuthProviderFactory` 型に依存
- **ブランチ**: `task/1-2-client-manager-di`
- **実装内容**:
  - [ ] `a2a-client-manager.ts` のコンストラクタを `{ proxy?, fetch?, authProviderFactory }` 形式へ変更
  - [ ] `Config` 参照箇所をすべて引数経由へ置換
  - [ ] `loadAgent(authHandler)` の公開シグネチャは維持
  - [ ] `a2a-client-manager.test.ts` を新 API に合わせて更新（モック差し替え）
- **確認手順** (Devcontainer 内):
  - [ ] `pnpm -F @google/gemini-cli-core test -- a2a-client-manager`
  - [ ] `pnpm -F @google/gemini-cli-core typecheck`
- **最終アクション**:
  - [ ] `gh pr create --base phase/1-client --head task/1-2-client-manager-di --draft`

### Task 1.3: `Config` 側初期化の更新（マイグレーションパス適用）
- **派生元**: Task 1.2 (`task/1-2-client-manager-di`)
- **理由**: 新コンストラクタ仕様に依存
- **ブランチ**: `task/1-3-config-wiring`
- **実装内容**:
  - [ ] `Config` 内 `A2AClientManager` 生成箇所で `proxy` / `fetch` / `authProviderFactory`（既定 `NoopAuthProviderFactory`）を引き渡す
  - [ ] 利用側コンシューマ（`agent-scheduler` 等）の呼び出しに破壊的変更がないこと確認
- **確認手順** (Devcontainer 内):
  - [ ] `pnpm -F @google/gemini-cli-core test`
  - [ ] `pnpm lint && pnpm typecheck`
- **最終アクション**:
  - [ ] `gh pr create --base phase/1-client --head task/1-3-config-wiring --draft`

### Phase 1 完了条件
- [ ] `A2AClientManager` コンストラクタから `Config` 型が消滅
- [ ] `a2a-client-manager.test.ts` 全件 Green
- [ ] `phase/1-client` の Draft PR を Ready に昇格し `master` へマージ

---

## Phase 2: サーバー側の再設計 (Server-Side Redesign)

### 目的
`a2a-server` から `TaskWrapper` と独自状態管理を撤去し、`Thin Router → LocalAgentExecutor → Event Adapter` の標準パイプラインへ再構築する。

### Phase Base: `phase/2-server`
- [ ] `git switch -c phase/2-server master`（Phase 1 マージ後の `master` から派生）
- [ ] `gh pr create --base master --head phase/2-server --draft --title "feat(a2a-server): Phase 2 base"`

### Task 2.1: `coder-agent-definition.ts` 追加
- **派生元**: Phase Base (`phase/2-server`)
- **理由**: 新規ファイル追加のみで単体完結
- **ブランチ**: `task/2-1-coder-agent-definition`
- **実装内容**:
  - [ ] `gemini-cli/packages/core/src/agents/coder-agent-definition.ts` を新設
  - [ ] `complete_task` ツール呼び出し時に A2A `completed` 状態へ遷移する Termination 契約を実装
  - [ ] ユニットテスト `coder-agent-definition.test.ts` 追加（TDD）
- **確認手順** (Devcontainer 内):
  - [ ] `pnpm -F @google/gemini-cli-core test -- coder-agent-definition`
- **最終アクション**:
  - [ ] `gh pr create --base phase/2-server --head task/2-1-coder-agent-definition --draft`

### Task 2.2: Event Adapter 実装（`GeminiEventType → CoderAgentEvent`）
- **派生元**: Phase Base (`phase/2-server`)
- **理由**: 変換ロジックは独立しており、`coder-agent-definition` 完成前でも作業可能
- **ブランチ**: `task/2-2-event-adapter`
- **実装内容**:
  - [ ] `gemini-cli/packages/a2a-server/src/agent/event-adapter.ts` 新設
  - [ ] 既存 `CoderAgentEvent` ストリーム互換を保つマッピングを実装
  - [ ] **スナップショットテスト** `event-adapter.test.ts` を追加（リスクで指定された Mitigation）
- **確認手順** (Devcontainer 内):
  - [ ] `pnpm -F @google/gemini-cli-a2a-server test -- event-adapter`
- **最終アクション**:
  - [ ] `gh pr create --base phase/2-server --head task/2-2-event-adapter --draft`

### Task 2.3: Thin Router 実装（`LocalAgentExecutor` 直接委譲）
- **派生元**: Task 2.1 (`task/2-1-coder-agent-definition`)
- **理由**: `coder-agent-definition` を実行コンテキストへ渡すため依存あり
- **ブランチ**: `task/2-3-thin-router`
- **実装内容**:
  - [ ] `gemini-cli/packages/a2a-server/src/agent/router.ts` 新設
  - [ ] `A2A Request → Context構築 → LocalAgentExecutor` のパイプラインを実装
  - [ ] 既存 `executor.ts` を Router 経由へ繋ぎ替え（並行運用可能な暫定モード）
- **確認手順** (Devcontainer 内):
  - [ ] `pnpm -F @google/gemini-cli-a2a-server test -- router`
  - [ ] `pnpm -F @google/gemini-cli-a2a-server typecheck`
- **最終アクション**:
  - [ ] `gh pr create --base phase/2-server --head task/2-3-thin-router --draft`

### Task 2.4: キャンセル伝播ブリッジ
- **派生元**: Task 2.3 (`task/2-3-thin-router`)
- **理由**: Router 内の `AbortController` を `LocalAgentExecutor.signal` に接続するため Router 実装に依存
- **ブランチ**: `task/2-4-cancellation-bridge`
- **実装内容**:
  - [ ] `cancelTask RPC → Router.AbortController.abort() → LocalAgentExecutor.signal` の経路を実装
  - [ ] 既存 `race-condition.test.ts` を Adapter 経由で実行する変種テストを追加
- **確認手順** (Devcontainer 内):
  - [ ] `pnpm -F @google/gemini-cli-a2a-server test -- race-condition`
- **最終アクション**:
  - [ ] `gh pr create --base phase/2-server --head task/2-4-cancellation-bridge --draft`

### Task 2.5: `TaskWrapper` と独自状態管理の撤去
- **派生元**: Task 2.4 (`task/2-4-cancellation-bridge`)
- **理由**: Router/Adapter/Cancellation が揃った後でないと撤去すると壊れる
- **ブランチ**: `task/2-5-remove-taskwrapper`
- **実装内容**:
  - [ ] `task.ts` / `task.test.ts` / `task-event-driven.test.ts` 等の `TaskWrapper` 関連コードを削除または Router/Adapter 経由へ置換
  - [ ] `PersistedStateMetadata` ベースの永続化レイヤを削除（**既存タスクは Drop 扱い**: 設計書記載通り）
  - [ ] `index.ts` / `http/app.ts` の Wiring を Router 経由に統一
- **確認手順** (Devcontainer 内):
  - [ ] `pnpm -F @google/gemini-cli-a2a-server test`（全件）
  - [ ] `pnpm lint && pnpm typecheck`
- **最終アクション**:
  - [ ] `gh pr create --base phase/2-server --head task/2-5-remove-taskwrapper --draft`

### Task 2.6: 検証コマンドによる総合確認
- **派生元**: Task 2.5 (`task/2-5-remove-taskwrapper`)
- **理由**: 全タスクのマージ済み状態でないと総合検証できない
- **ブランチ**: `task/2-6-final-verification`
- **実装内容**:
  - [ ] `npm run test -w @google/gemini-cli-a2a-server` の Devcontainer 内実行ログを残す
  - [ ] `npm run test -w @google/gemini-cli-core -- src/agents/a2a-client-manager.test.ts` の実行ログを残す
  - [ ] 必要なドキュメント更新（`README.md` の旧 `TaskWrapper` 記述削除など）
- **確認手順** (Devcontainer 内):
  - [ ] 上記 2 コマンドが Green
  - [ ] `pnpm test:coverage` でカバレッジ閾値維持
- **最終アクション**:
  - [ ] `gh pr create --base phase/2-server --head task/2-6-final-verification --draft`

### Phase 2 完了条件
- [ ] `TaskWrapper` と独自状態管理コードが完全削除
- [ ] Event Adapter スナップショットテスト Green
- [ ] `a2a-server/src/agent/*.test.ts` 全件 Green
- [ ] `phase/2-server` を Ready に昇格し `master` へマージ

---

## Risks（設計書から継承）

| Risk | Mitigation | 対応 Task |
| --- | --- | --- |
| 既存タスクのロスト | メンテナンスウィンドウ告知・低トラフィック時間帯デプロイ | Phase 2 リリース手順（運用側） |
| Event Adapter 不完全性 | スナップショットテスト | Task 2.2 |
| キャンセル伝播の取りこぼし | `race-condition.test.ts` を Adapter 経由実行 | Task 2.4 |

## Success Criteria（設計書 §Success Criteria を継承）

1. クライアント側: `A2AClientManager` から `Config` 依存消失、`a2a-client-manager.test.ts` Green
2. サーバー側: `TaskWrapper` と独自状態管理コード削除、Event Adapter 単体テスト追加・Green、`a2a-server/src/agent/*.test.ts` 全件 Green
3. 検証コマンド (Devcontainer 内):
   - `pnpm -F @google/gemini-cli-a2a-server test`
   - `pnpm -F @google/gemini-cli-core test -- src/agents/a2a-client-manager.test.ts`
