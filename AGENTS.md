# opencode-a2a-core Agent Instructions

This document provides context for AI agents working on the `opencode-a2a-core` repository.

## 🎯 Purpose (WHY)
A robust, headless execution engine for integrating AI agents as "thin wrappers". It centralizes decision-making in a Master Agent and uses a strict Agent-to-Agent (A2A) protocol to prevent semantic drift.

## 🏗️ Architecture & Tech Stack (WHAT)
- **Stack**: TypeScript, Node.js v22, Hono, Zod, Vitest, pnpm.
- **Structure**:
  - `src/core/`: Core protocol (Zod schemas), TaskRunner, TaskStore, Plugin registry.
  - `src/plugins/`: Specific implementations (e.g., `GeminiCliPlugin`).
  - `src/server/`: HTTP Server Adapter providing JSON-RPC 2.0 over POST and SSE streaming.
- **Detailed Spec**: For protocol definitions, plugin interfaces, and server adapter details, see [`SPEC.md`](./SPEC.md).

## 🛠️ Commands (HOW)
Use `pnpm` for package management. **All execution MUST be done inside the Devcontainer.**

- **Test**: `pnpm test` (or `pnpm vitest run <file>`)
- **Lint**: `pnpm lint`
- **Typecheck**: `pnpm typecheck`
- **Build**: `pnpm build`

## 🧠 Key Agent Behaviors & Rules
- **No Autonomy (Fail-Fast)**: Do not try to implement complex autonomous fallback logic for plugins. The system is designed to halt on `NonRetriableError` and defer to the Master Agent.
- **Strict Typing**: Rely on Zod schemas in `src/core/a2a-types.ts` and `src/server/rpc/schema.ts`. Do not bypass TypeScript constraints.
- **Progressive Disclosure**: Do not duplicate architecture rules here. Read [`SPEC.md`](./SPEC.md) for deeper implementation details when touching core logic, server, or plugins.
- **Linters over Instructions**: Run `pnpm lint` and `pnpm typecheck` to verify your code. Fix any errors they report.
