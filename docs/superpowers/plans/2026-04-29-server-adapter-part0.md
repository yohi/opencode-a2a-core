# HTTP Server Adapter — Implementation Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**設計書:** `docs/superpowers/specs/2026-04-28-server-adapter-design.md`

---

## Phase 0: N/A (既存インフラ確認済み)

CI/CD (`.github/workflows/ci.yml`) と Devcontainer (`.devcontainer/devcontainer.json`) は既に構築済み。

> **NOTE:** 既存 CI は `ubuntu-latest` を使用中。`ubuntu-slim` への変更が必要な場合は別途対応。

---

## Phase 1: Server Adapter 実装

### Git Branch Strategy

```text
master
 └─ feature/phase1_server-adapter__base     (← master から作成)
      ├─ Task 1: rpc-schema                (← Base: 独立)
      ├─ Task 2: auth-middleware            (← Base: 独立)
      ├─ Task 3: rpc-handler               (← Task2: auth 依存)
      ├─ Task 4: server-factory             (← Task3: handler 依存)
      └─ Task 5: stream-cancel              (← Task4: factory 依存)
```

### Task Summary

| Task | ファイル | 派生元 | 概要 |
|------|---------|--------|------|
| 1 | `src/server/rpc/schema.ts` | Base | JSON-RPC 2.0 Zod スキーマ + エラーコード定数 |
| 2 | `src/server/middleware/auth.ts` | Base | timing-safe Bearer 認証ミドルウェア |
| 3 | `src/server/rpc/handler.ts` | Task2 | JSON-RPC メソッドディスパッチャ (全4メソッド) |
| 4 | `src/server/index.ts` | Task3 | `createA2AServer()` ファクトリ + AgentCard |
| 5 | `tests/server/index.test.ts` (追加) | Task4 | stream/cancel 結合テスト + public export |

### Plan Files

1. **Part 1** — `2026-04-29-server-adapter-part1.md`: Git 戦略、ファイル構成、Task 1
2. **Part 2** — `2026-04-29-server-adapter-part2.md`: Task 2, Task 3
3. **Part 3** — `2026-04-29-server-adapter-part3.md`: Task 4, Task 5, Phase 完了手順

### Prerequisites

```bash
pnpm add hono
```

### 全タスク共通ルール

- **テスト・静的解析は必ず Devcontainer 環境内で実行**
- 各 Task 完了時に Phase Base (`feature/phase1_server-adapter__base`) へ Draft PR を作成
- Phase 完了時に `master` へ Draft PR を作成
