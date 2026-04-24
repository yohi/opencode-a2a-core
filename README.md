# 🔌 opencode-a2a-core

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg) ![Protocol](https://img.shields.io/badge/A2A_Protocol-v1.0.0-success.svg) ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg) ![Bun](https://img.shields.io/badge/Bun-Ready-black.svg)

> **OpenCode拡張のためのA2A共通基盤 ＆ プラグインフレームワーク**
> AIエージェントを「APIの薄いラッパー」として統合・駆動するための、堅牢で自律性を持たない（ヘッドレスな）実行エンジン。

## 📖 概要 (Overview)

`opencode-a2a-core` は、マルチエージェント環境（MAS）において頻発する**「意味論的ドリフト（解釈の齟齬）」を防ぐため**に設計された、A2A（Agent-to-Agent）プロトコル通信のコアフレームワークです。

これまで `GeminiCLI` や `CursorCLI` 向けに個別に実装されていた通信・実行ロジックをリファクタリングし、堅牢な**「共通コア基盤」**と、各ツール固有の処理を切り替える**「プラグイン」**へと分割・統合しました。

### 🧠 設計思想: 主導権集中アプローチ（非対称委任モデル）

本基盤の最大の特徴は、エージェント間連携において**対等な関係を捨て、主導権を完全にマスターエージェントに集中させる**点にあります。

* **👑 エージェントA（Master）**: 推論、計画、ツール選択の全権を握るオーケストレーター。
* **⚙️ エージェントB（Worker / 本システム）**: 独自の推論を持たず、渡された指示を愚直にAPIリクエストへ変換する「薄いラッパー」に徹する。

```text
[ Master Agent (Agent A) ]
       │
       │ (A2A Protocol / Zod Schemas)
       ▼
┌─────────────────────────────────────────┐
│  opencode-a2a-core (Agent B / Wrapper)  │
│                                         │
│  ├─ Core Task Runner (Retry / Halt)     │
│  └─ Plugin Interface                    │
│       ├─ Gemini CLI Plugin              │
│       ├─ Cursor CLI Plugin              │
│       └─ Claude Code Plugin             │
└─────────────────────────────────────────┘
       │ (Direct Headless Execution)
       ▼
[ External APIs & Local CLI Tools ]
```

### ✨ 主な特長 (Key Features)

1. **🔌 柔軟なプラグイン拡張 (Plugin Architecture)**
   共通の `A2APluginInterface` を実装することで、新しいCLIツールやAPIを容易にエージェント網へ組み込むことができます。
2. **🛡️ 型による強固な契約 (Type-Safe Protocol)**
   Zodを用いた厳格なスキーマ検証（`Message`, `TaskStatus`, `Artifact`等）により、A2A通信における不正なペイロードを水際でブロックします。
3. **🛑 厳密な自律性制御 (Strict Execution Control)**
   最大3回の再試行（Exponential Backoff）を備えつつも、**自律的な問題解決（推論の暴走）をシステムレベルで禁止**。エラー時は直ちに処理を停止し、マスターへ判断を委ねるフェイルセーフ設計を採用しています。
4. **🐳 再現性の担保 (Devcontainer Forced)**
   環境依存のバグを排除するため、開発・テスト・静的解析はすべて提供されるDevcontainer環境内で完結するよう設計されています。
---

<FollowUp label="実際のコード生成（TypeScript実装）に進みますか？" query="では、先ほど作成した第3のプロンプト（Claude Opus 4.7用）を使って、実際のコード出力（Zodスキーマやコアランナーの実装）をシミュレートしてください。" />
