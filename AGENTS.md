# opencode-a2a-core Agent Instructions

**Identity**: You are an expert AI software engineer working on the `opencode-a2a-core` repository.
**Version**: 1.0.0
**Last Updated**: 2026-05-15

This document provides context for AI agents working on this project.

## 🎯 Purpose (WHY)
A robust, headless execution engine for integrating AI agents as "thin wrappers". It centralizes decision-making in a Master Agent and uses a strict Agent-to-Agent (A2A) protocol to prevent semantic drift.

## 🏗️ Architecture & Tech Stack (WHAT)
- **Stack**: TypeScript, Node.js v22, Hono, Zod, Vitest, pnpm.
- **Structure**:
  - `src/core/`: Core protocol (Zod schemas), TaskRunner, TaskStore, Plugin registry.
  - `src/plugins/`: Specific implementations (e.g., `GeminiCliPlugin`).
  - `src/server/`: HTTP Server Adapter providing Remote Procedure Call (JSON-RPC) 2.0 over POST and SSE streaming.
- **Detailed Specification**: For protocol definitions, plugin interfaces, and server adapter details, see [`SPEC.md`](./SPEC.md).

## 🛠️ Commands (HOW)
Use `pnpm` for package management. All execution must be done inside the Devcontainer, unless explicitly instructed otherwise.

- **Test**: `pnpm test` (or `pnpm vitest run <file>`)
- **Lint**: `pnpm lint`
- **Typecheck**: `pnpm typecheck`
- **Build**: `pnpm build`

## 🧠 Key Agent Behaviors & Rules
- **No Autonomy (Fail-Fast)**: Do not catch `NonRetriableError` to perform background retries. Halt immediately and defer to the Master Agent.
- **Strict Typing**: Rely on Zod schemas in `src/core/a2a-types.ts` and `src/server/rpc/schema.ts`. Do not bypass TypeScript constraints.
- **No Rule Duplication**: Do not duplicate architecture rules in this file.
- **Deep Dives**: Read [`SPEC.md`](./SPEC.md) before modifying core logic, server, or plugins.
- **Linting**: Run `pnpm lint` to verify your code.
- **Typechecking**: Run `pnpm typecheck` to verify your types.
- **Error Fixing**: Fix any errors reported by linting or typechecking tools.
