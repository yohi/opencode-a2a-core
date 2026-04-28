# opencode-a2a-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a headless, A2A v1.0.0-compliant thin-wrapper agent foundation (`opencode-a2a-core`) with a strict plugin architecture, where Gemini/Cursor/ClaudeCode implementations can be swapped, and retries are bounded to 3 attempts with no autonomous fallback.

**Architecture:** Library-first core (`src/core/`) with an optional HTTP server adapter (`src/server/`, follow-up plan) and CLI-specific plugins (`src/plugins/`). `TaskRunner` owns retry/state-transition semantics; plugins only handle message→CLI translation. Plugins self-declare Zod config schemas and stream `StreamResponse` via `AsyncIterable`.

**Tech Stack:** Node.js 22 LTS · TypeScript 5.6+ · pnpm 9 · Vitest 2 · Zod 3 · (Hono 4 — follow-up server plan only).

**Scope of this plan:** Core library + Devcontainer + Gemini plugin example. HTTP server adapter (`src/server/*`) is deferred to a follow-up plan.

**Spec reference:** `docs/superpowers/specs/2026-04-24-opencode-a2a-core-design.md`

---

## ブランチ運用ルール

- **Phase ブランチ**は常に `master` から作成し、`master` をベースとした Draft PR を作成する。
- 前の Phase の PR が `master` にマージされるまで次の Phase には進まない。
- **Task ブランチ**は直前の Task ブランチから派生して作成する（Phase 内最初の Task は Phase ブランチから派生）。
- 各 Task 完了時に Phase ブランチをベースとした Draft PR を作成する。

## Phase 概要

| Phase | 内容               | Phase ブランチ                            | Task 数 |
| ----- | ------------------ | ----------------------------------------- | ------- |
| 0     | CI/CD セットアップ | `feature/phase0__ci-setup__base`          | 1       |
| 1     | プロジェクト基盤   | `feature/phase1__project-scaffold__base`  | 3       |
| 2     | コアモジュール     | `feature/phase2__core-modules__base`      | 8       |
| 3     | TaskRunner         | `feature/phase3__task-runner__base`       | 7       |
| 4     | 設定とプラグイン   | `feature/phase4__config-and-plugin__base` | 3       |

---

## File Structure (this plan produces)

```
opencode-a2a-core/
├── .devcontainer/
│   └── devcontainer.json            [P1-T2]
├── .github/
│   └── workflows/ci.yml             [P0-T1]
├── src/
│   ├── core/
│   │   ├── a2a-types.ts             [P2-T3]
│   │   ├── errors.ts                [P2-T1]
│   │   ├── logger.ts                [P2-T2]
│   │   ├── plugin-interface.ts      [P2-T5]
│   │   ├── define-plugin.ts         [P2-T5]
│   │   ├── registry.ts              [P2-T6]
│   │   ├── task-store.ts            [P2-T7]
│   │   ├── config-loader.ts         [P4-T1]
│   │   ├── task-runner.ts           [P3-T1–T7]
│   │   └── helpers/
│   │       ├── exponential-backoff.ts  [P2-T4]
│   │       └── subprocess.ts           [P2-T8]
│   ├── plugins/
│   │   └── gemini-cli-plugin.ts     [P4-T2–T3]
│   └── index.ts                     [P2-T5 (initial), extended later]
├── tests/
│   ├── core/*.test.ts               [co-located per task]
│   └── integration/
│       └── gemini-cli-plugin.test.ts [P4-T3]
├── tests/fixtures/
│   └── fake-gemini-cli.mjs          [P4-T3]
├── package.json                     [P1-T1]
├── tsconfig.json                    [P1-T1]
├── tsconfig.build.json              [P1-T1]
├── vitest.config.ts                 [P1-T1]
├── .eslintrc.cjs                    [P1-T3]
├── .prettierrc.json                 [P1-T3]
├── .gitignore                       [P1-T1]
└── README.md                        [already present on master]
```

**Ownership rule (enforced by code-review during implementation):**

- `src/core/` depends only on `zod`.
- `src/plugins/` depends only on `src/core/`.
- Tests live under `tests/` mirroring the source tree (not co-located) to keep `src/` clean for publication.

---

## Phase 0: CI/CD セットアップ

> **Phase ブランチ:** `feature/phase0__ci-setup__base` （`master` から作成）
> **Phase PR:** `feature/phase0__ci-setup__base` → `master` (Draft)

### Task 1: GitHub Actions CI ワークフロー

> **ブランチ:** `feature/phase0-task1__github-actions` （`feature/phase0__ci-setup__base` から派生）
> **PR:** → `feature/phase0__ci-setup__base` (Draft)

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1.1: Create CI workflow**

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-slim
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.node-version'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/
```

- [ ] **Step 1.2: Create `.node-version`**

```
22
```

- [ ] **Step 1.3: Commit**

```bash
git add .github/workflows/ci.yml .node-version
git commit -m "ci: GitHub Actions CI ワークフローを追加（ubuntu-slim + pnpm）"
```

- [ ] **Step 1.4: Draft PR を作成**

  `feature/phase0-task1__github-actions` → `feature/phase0__ci-setup__base` へ Draft PR を作成する。

---

## Phase 1: プロジェクト基盤

> **Phase ブランチ:** `feature/phase1__project-scaffold__base` （`master` から作成、Phase 0 の PR が `master` にマージ済みであること）
> **Phase PR:** `feature/phase1__project-scaffold__base` → `master` (Draft)

### Task 1: Scaffold project (package.json, TS, Vitest, gitignore)

> **ブランチ:** `feature/phase1-task1__scaffold` （`feature/phase1__project-scaffold__base` から派生）
> **PR:** → `feature/phase1__project-scaffold__base` (Draft)

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.npmrc`

- [ ] **Step 1.1: Create `.gitignore`**

```gitignore
node_modules/
dist/
coverage/
*.log
.env
.env.local
.DS_Store
```

- [ ] **Step 1.2: Create `.npmrc`**

```ini
engine-strict=true
auto-install-peers=true
```

- [ ] **Step 1.3: Create `package.json`**

```json
{
  "name": "@yohi/opencode-a2a-core",
  "version": "0.1.0",
  "description": "Headless A2A v1.0.0 thin-wrapper agent foundation with a pluggable CLI backend",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@9",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests",
    "format": "prettier --write src tests"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "@typescript-eslint/parser": "^8.8.0",
    "@vitest/coverage-v8": "^2.1.1",
    "eslint": "^9.11.1",
    "prettier": "^3.3.3",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 1.4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 1.5: Create `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "tests", "**/*.test.ts"]
}
```

- [ ] **Step 1.6: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
    },
    testTimeout: 10000,
  },
});
```

- [ ] **Step 1.7: Install dependencies**

Run: `pnpm install`
Expected: Dependencies installed, `pnpm-lock.yaml` created.

- [ ] **Step 1.8: Verify scaffolding**

Run: `pnpm typecheck`
Expected: Exits 0 (no source files yet, but config parses).

- [ ] **Step 1.9: Commit**

```bash
git add .gitignore .npmrc package.json tsconfig.json tsconfig.build.json vitest.config.ts pnpm-lock.yaml
git commit -m "chore: scaffold TypeScript/pnpm/Vitest project setup"
```

- [ ] **Step 1.10: Draft PR を作成**

  `feature/phase1-task1__scaffold` → `feature/phase1__project-scaffold__base` へ Draft PR を作成する。

---

### Task 2: Create Devcontainer

> **ブランチ:** `feature/phase1-task2__devcontainer` （`feature/phase1-task1__scaffold` から派生）
> **PR:** → `feature/phase1__project-scaffold__base` (Draft)

**Files:**

- Create: `.devcontainer/devcontainer.json`

- [ ] **Step 2.1: Create devcontainer.json**

```json
{
  "name": "opencode-a2a-core",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm",
  "features": {
    "ghcr.io/devcontainers/features/common-utils:2": {},
    "ghcr.io/devcontainers/features/git:1": {}
  },
  "postCreateCommand": "corepack enable && corepack prepare pnpm@9 --activate && pnpm install --frozen-lockfile",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "vitest.explorer"
      ],
      "settings": {
        "typescript.tsdk": "node_modules/typescript/lib",
        "editor.formatOnSave": true
      }
    }
  },
  "containerEnv": {
    "NODE_ENV": "development"
  },
  "remoteUser": "node",
  "mounts": [],
  "forwardPorts": [3000]
}
```

- [ ] **Step 2.2: Commit**

```bash
git add .devcontainer/devcontainer.json
git commit -m "chore: add Devcontainer (Node 22 + pnpm@9 pinned)"
```

- [ ] **Step 2.3: Draft PR を作成**

  `feature/phase1-task2__devcontainer` → `feature/phase1__project-scaffold__base` へ Draft PR を作成する。

---

### Task 3: ESLint + Prettier

> **ブランチ:** `feature/phase1-task3__eslint-prettier` （`feature/phase1-task2__devcontainer` から派生）
> **PR:** → `feature/phase1__project-scaffold__base` (Draft)

**Files:**

- Create: `.eslintrc.cjs`
- Create: `.prettierrc.json`
- Create: `.prettierignore`

- [ ] **Step 3.1: Create `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: './tsconfig.json' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'error',
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/'],
};
```

- [ ] **Step 3.2: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 3.3: Create `.prettierignore`**

```
dist/
coverage/
node_modules/
pnpm-lock.yaml
```

- [ ] **Step 3.4: Verify lint runs (no files yet, so should pass trivially)**

Run: `pnpm lint || true`
Expected: No lint errors (no source files yet).

- [ ] **Step 3.5: Commit**

```bash
git add .eslintrc.cjs .prettierrc.json .prettierignore
git commit -m "chore: add ESLint + Prettier config"
```

- [ ] **Step 3.6: Draft PR を作成**

  `feature/phase1-task3__eslint-prettier` → `feature/phase1__project-scaffold__base` へ Draft PR を作成する。

---

## Phase 2: コアモジュール

> **Phase ブランチ:** `feature/phase2__core-modules__base` （`master` から作成、Phase 1 の PR が `master` にマージ済みであること）
> **Phase PR:** `feature/phase2__core-modules__base` → `master` (Draft)

### Task 1: Errors module

> **ブランチ:** `feature/phase2-task1__errors` （`feature/phase2__core-modules__base` から派生）
> **PR:** → `feature/phase2__core-modules__base` (Draft)

**Files:**

- Create: `src/core/errors.ts`
- Create: `tests/core/errors.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `tests/core/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  A2AError,
  NonRetriableError,
  SubprocessError,
  serializeError,
} from '../../src/core/errors.js';

describe('A2AError hierarchy', () => {
  it('A2AError carries code + message', () => {
    const err = new A2AError('BOOM', 'something went wrong');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(A2AError);
    expect(err.code).toBe('BOOM');
    expect(err.message).toBe('something went wrong');
  });

  it('NonRetriableError is an A2AError and signals no retry', () => {
    const err = new NonRetriableError('PluginNotFound');
    expect(err).toBeInstanceOf(A2AError);
    expect(err.code).toBe('NonRetriable');
    expect(err.message).toBe('PluginNotFound');
  });

  it('SubprocessError carries exitCode and stderr', () => {
    const err = new SubprocessError(127, 'command not found');
    expect(err).toBeInstanceOf(A2AError);
    expect(err.code).toBe('SubprocessFailed');
    expect(err.exitCode).toBe(127);
    expect(err.stderr).toBe('command not found');
  });
});

describe('serializeError', () => {
  it('serializes A2AError to { code, message }', () => {
    const out = serializeError(new A2AError('X', 'y'));
    expect(out).toEqual({ code: 'X', message: 'y' });
  });

  it("serializes generic Error to { code: 'Unknown', message }", () => {
    const out = serializeError(new Error('oops'));
    expect(out).toEqual({ code: 'Unknown', message: 'oops' });
  });

  it("serializes non-Error values to { code: 'Unknown', message: String(v) }", () => {
    expect(serializeError('string-err')).toEqual({
      code: 'Unknown',
      message: 'string-err',
    });
    expect(serializeError(42)).toEqual({ code: 'Unknown', message: '42' });
    expect(serializeError(null)).toEqual({ code: 'Unknown', message: 'null' });
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `pnpm test tests/core/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `src/core/errors.ts`**

```ts
export class A2AError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'A2AError';
  }
}

export class NonRetriableError extends A2AError {
  constructor(message: string) {
    super('NonRetriable', message);
    this.name = 'NonRetriableError';
  }
}

export class SubprocessError extends A2AError {
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super('SubprocessFailed', `subprocess exited with ${exitCode}: ${stderr}`);
    this.name = 'SubprocessError';
  }
}

export function serializeError(err: unknown): {
  code: string;
  message: string;
} {
  if (err instanceof A2AError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: 'Unknown', message: err.message };
  return { code: 'Unknown', message: String(err) };
}
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `pnpm test tests/core/errors.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 4.5: Commit**

```bash
git add src/core/errors.ts tests/core/errors.test.ts
git commit -m "feat(core): add A2AError hierarchy + serializeError"
```

- [ ] **Step 4.6: Draft PR を作成**

  `feature/phase2-task1__errors` → `feature/phase2__core-modules__base` へ Draft PR を作成する。

---

### Task 2: Logger module

> **ブランチ:** `feature/phase2-task2__logger` （`feature/phase2-task1__errors` から派生）
> **PR:** → `feature/phase2__core-modules__base` (Draft)

**Files:**

- Create: `src/core/logger.ts`
- Create: `tests/core/logger.test.ts`

- [ ] **Step 5.1: Write the failing test**

Create `tests/core/logger.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ConsoleLogger, type Logger } from '../../src/core/logger.js';

describe('ConsoleLogger', () => {
  it('implements Logger interface', () => {
    const log: Logger = new ConsoleLogger();
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('writes info to stdout in JSON format', () => {
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const log = new ConsoleLogger({ level: 'info' });
    log.info('hello', { taskId: 't1' });
    expect(spy).toHaveBeenCalledOnce();
    const [line] = spy.mock.calls[0] as [string];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.taskId).toBe('t1');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    spy.mockRestore();
  });

  it('filters below configured level', () => {
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const log = new ConsoleLogger({ level: 'warn' });
    log.debug('hidden');
    log.info('hidden');
    log.warn('shown');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('masks secret-like keys in context', () => {
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const log = new ConsoleLogger({ level: 'info' });
    log.info('event', { apiKey: 's3cr3t', token: 'abc', safe: 'ok' });
    const [line] = spy.mock.calls[0] as [string];
    const parsed = JSON.parse(line);
    expect(parsed.apiKey).toBe('***');
    expect(parsed.token).toBe('***');
    expect(parsed.safe).toBe('ok');
    spy.mockRestore();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `pnpm test tests/core/logger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `src/core/logger.ts`**

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const MASK_KEYS = new Set([
  'apiKey',
  'token',
  'password',
  'authorization',
  'bearer',
]);

export class ConsoleLogger implements Logger {
  private readonly threshold: number;

  constructor(opts: { level?: LogLevel } = {}) {
    this.threshold = LEVELS[opts.level ?? 'info'];
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('debug', msg, ctx);
  }
  info(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('info', msg, ctx);
  }
  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('warn', msg, ctx);
  }
  error(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('error', msg, ctx);
  }

  private emit(
    level: LogLevel,
    msg: string,
    ctx?: Record<string, unknown>
  ): void {
    if (LEVELS[level] < this.threshold) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      msg,
      ...this.mask(ctx ?? {}),
    };
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }

  private mask(ctx: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ctx)) {
      out[k] = MASK_KEYS.has(k.toLowerCase()) ? '***' : v;
    }
    return out;
  }
}
```

- [ ] **Step 5.4: Run test to verify it passes**

Run: `pnpm test tests/core/logger.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5.5: Commit**

```bash
git add src/core/logger.ts tests/core/logger.test.ts
git commit -m "feat(core): add ConsoleLogger with secret-key masking"
```

- [ ] **Step 5.6: Draft PR を作成**

  `feature/phase2-task2__logger` → `feature/phase2__core-modules__base` へ Draft PR を作成する。

---

### Task 3: A2A Zod types

> **ブランチ:** `feature/phase2-task3__a2a-types` （`feature/phase2-task2__logger` から派生）
> **PR:** → `feature/phase2__core-modules__base` (Draft)

**Files:**

- Create: `src/core/a2a-types.ts`
- Create: `tests/core/a2a-types.test.ts`

- [ ] **Step 6.1: Write the failing test**

Create `tests/core/a2a-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  A2A_PROTOCOL_VERSION,
  PartSchema,
  MessageSchema,
  TaskStateSchema,
  TaskStatusSchema,
  ArtifactSchema,
  TaskSchema,
  StreamResponseSchema,
} from '../../src/core/a2a-types.js';

describe('A2A_PROTOCOL_VERSION', () => {
  it('is 1.0.0', () => {
    expect(A2A_PROTOCOL_VERSION).toBe('1.0.0');
  });
});

describe('PartSchema discriminated union', () => {
  it('accepts TextPart', () => {
    expect(PartSchema.parse({ kind: 'text', text: 'hi' })).toEqual({
      kind: 'text',
      text: 'hi',
    });
  });

  it('accepts FilePart with bytes', () => {
    expect(
      PartSchema.parse({
        kind: 'file',
        file: { name: 'a.txt', bytes: 'aGVsbG8=' },
      })
    ).toMatchObject({ kind: 'file', file: { name: 'a.txt' } });
  });

  it('accepts DataPart with arbitrary data', () => {
    expect(PartSchema.parse({ kind: 'data', data: { x: 1 } })).toEqual({
      kind: 'data',
      data: { x: 1 },
    });
  });

  it('rejects unknown kind', () => {
    expect(() => PartSchema.parse({ kind: 'video', src: 'x' })).toThrow();
  });
});

describe('MessageSchema', () => {
  it('requires role and parts', () => {
    expect(() => MessageSchema.parse({ role: 'ROLE_USER' })).toThrow();
    const m = MessageSchema.parse({
      role: 'ROLE_USER',
      parts: [{ kind: 'text', text: 'hi' }],
    });
    expect(m.role).toBe('ROLE_USER');
    expect(m.parts).toHaveLength(1);
  });

  it('accepts optional messageId and taskId', () => {
    const m = MessageSchema.parse({
      role: 'ROLE_AGENT',
      parts: [{ kind: 'text', text: 'ok' }],
      messageId: 'm-1',
      taskId: 't-1',
    });
    expect(m.messageId).toBe('m-1');
    expect(m.taskId).toBe('t-1');
  });
});

describe('TaskStateSchema', () => {
  it('accepts the five defined states', () => {
    for (const s of [
      'TASK_STATE_PENDING',
      'TASK_STATE_WORKING',
      'TASK_STATE_COMPLETED',
      'TASK_STATE_FAILED',
      'TASK_STATE_CANCELED',
    ]) {
      expect(TaskStateSchema.parse(s)).toBe(s);
    }
  });

  it('rejects unknown states', () => {
    expect(() => TaskStateSchema.parse('TASK_STATE_UNKNOWN')).toThrow();
  });
});

describe('TaskStatusSchema / ArtifactSchema / TaskSchema', () => {
  it('TaskStatus with state+message+timestamp parses', () => {
    expect(
      TaskStatusSchema.parse({
        state: 'TASK_STATE_FAILED',
        message: 'boom',
        timestamp: '2026-04-24T10:00:00Z',
      })
    ).toMatchObject({ state: 'TASK_STATE_FAILED' });
  });

  it('Artifact requires artifactId and parts', () => {
    const a = ArtifactSchema.parse({
      artifactId: 'a-1',
      parts: [{ kind: 'text', text: 'ok' }],
    });
    expect(a.artifactId).toBe('a-1');
  });

  it('Task requires id and status', () => {
    const t = TaskSchema.parse({
      id: 't-1',
      status: { state: 'TASK_STATE_PENDING' },
    });
    expect(t.id).toBe('t-1');
  });
});

describe('StreamResponseSchema discriminated union', () => {
  it('accepts kind=task', () => {
    const r = StreamResponseSchema.parse({
      kind: 'task',
      task: { id: 't-1', status: { state: 'TASK_STATE_PENDING' } },
    });
    expect(r.kind).toBe('task');
  });

  it('accepts kind=status-update', () => {
    expect(
      StreamResponseSchema.parse({
        kind: 'status-update',
        status: { state: 'TASK_STATE_WORKING' },
      }).kind
    ).toBe('status-update');
  });

  it('accepts kind=artifact-update', () => {
    expect(
      StreamResponseSchema.parse({
        kind: 'artifact-update',
        artifact: { artifactId: 'a1', parts: [{ kind: 'text', text: 'x' }] },
      }).kind
    ).toBe('artifact-update');
  });

  it('accepts kind=message', () => {
    expect(
      StreamResponseSchema.parse({
        kind: 'message',
        message: { role: 'ROLE_AGENT', parts: [{ kind: 'text', text: 'hi' }] },
      }).kind
    ).toBe('message');
  });

  it('rejects unknown kind', () => {
    expect(() => StreamResponseSchema.parse({ kind: 'oops' })).toThrow();
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `pnpm test tests/core/a2a-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement `src/core/a2a-types.ts`**

```ts
import { z } from 'zod';

export const A2A_PROTOCOL_VERSION = '1.0.0' as const;

// ---- Parts ----
export const TextPartSchema = z.object({
  kind: z.literal('text'),
  text: z.string(),
});

export const FilePartSchema = z.object({
  kind: z.literal('file'),
  file: z
    .object({
      name: z.string().optional(),
      mimeType: z.string().optional(),
      bytes: z.string().optional(), // base64
      uri: z.string().url().optional(),
    })
    .refine((f) => f.bytes != null || f.uri != null, {
      message: 'FilePart requires either bytes or uri',
    }),
});

export const DataPartSchema = z.object({
  kind: z.literal('data'),
  data: z.record(z.unknown()),
});

export const PartSchema = z.discriminatedUnion('kind', [
  TextPartSchema,
  FilePartSchema,
  DataPartSchema,
]);
export type Part = z.infer<typeof PartSchema>;

// ---- Message ----
export const MessageSchema = z.object({
  role: z.enum(['ROLE_USER', 'ROLE_AGENT']),
  parts: z.array(PartSchema).min(1),
  messageId: z.string().optional(),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

// ---- Task state/status ----
export const TaskStateSchema = z.enum([
  'TASK_STATE_PENDING',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TaskStatusSchema = z.object({
  state: TaskStateSchema,
  timestamp: z.string().optional(),
  message: z.string().optional(),
});
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// ---- Artifact ----
export const ArtifactSchema = z.object({
  artifactId: z.string(),
  parts: z.array(PartSchema).min(1),
  name: z.string().optional(),
  description: z.string().optional(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

// ---- Task ----
export const TaskSchema = z.object({
  id: z.string(),
  contextId: z.string().optional(),
  status: TaskStatusSchema,
  artifacts: z.array(ArtifactSchema).optional(),
  history: z.array(TaskStatusSchema).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

// ---- Stream response (discriminated union) ----
export const StreamResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task'), task: TaskSchema }),
  z.object({ kind: z.literal('message'), message: MessageSchema }),
  z.object({ kind: z.literal('status-update'), status: TaskStatusSchema }),
  z.object({ kind: z.literal('artifact-update'), artifact: ArtifactSchema }),
]);
export type StreamResponse = z.infer<typeof StreamResponseSchema>;
```

- [ ] **Step 6.4: Run test to verify it passes**

Run: `pnpm test tests/core/a2a-types.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6.5: Commit**

```bash
git add src/core/a2a-types.ts tests/core/a2a-types.test.ts
git commit -m "feat(core): add A2A v1.0.0 Zod schemas + types"
```

- [ ] **Step 6.6: Draft PR を作成**

  `feature/phase2-task3__a2a-types` → `feature/phase2__core-modules__base` へ Draft PR を作成する。

---

### Task 4: Exponential backoff helper

> **ブランチ:** `feature/phase2-task4__exponential-backoff` （`feature/phase2-task3__a2a-types` から派生）
> **PR:** → `feature/phase2__core-modules__base` (Draft)

**Files:**

- Create: `src/core/helpers/exponential-backoff.ts`
- Create: `tests/core/helpers/exponential-backoff.test.ts`

- [ ] **Step 7.1: Write the failing test**

Create `tests/core/helpers/exponential-backoff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeBackoffMs } from '../../../src/core/helpers/exponential-backoff.js';

describe('computeBackoffMs', () => {
  const opts = { initialMs: 500, multiplier: 2, jitterRatio: 0 };

  it('computes exponentially with zero jitter', () => {
    expect(computeBackoffMs(1, opts)).toBe(500); // 500 * 2^0
    expect(computeBackoffMs(2, opts)).toBe(1000); // 500 * 2^1
    expect(computeBackoffMs(3, opts)).toBe(2000); // 500 * 2^2
  });

  it('adds jitter within ±ratio range', () => {
    const optsWithJitter = { initialMs: 1000, multiplier: 2, jitterRatio: 0.2 };
    const rng = () => 0.5; // deterministic
    // base = 1000 * 2^(n-1); jitter factor = 1 + (2*0.5 - 1) * 0.2 = 1
    expect(computeBackoffMs(1, optsWithJitter, rng)).toBe(1000);
    const rngLow = () => 0; // factor = 1 - 0.2 = 0.8
    expect(computeBackoffMs(1, optsWithJitter, rngLow)).toBe(800);
    const rngHigh = () => 1; // factor = 1 + 0.2 = 1.2
    expect(computeBackoffMs(1, optsWithJitter, rngHigh)).toBe(1200);
  });

  it('throws on attempt < 1', () => {
    expect(() => computeBackoffMs(0, opts)).toThrow();
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `pnpm test tests/core/helpers/exponential-backoff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7.3: Implement `src/core/helpers/exponential-backoff.ts`**

```ts
export interface BackoffOptions {
  initialMs: number;
  multiplier: number;
  jitterRatio: number; // 0 = no jitter, 0.2 = ±20%
}

export function computeBackoffMs(
  attempt: number,
  opts: BackoffOptions,
  rng: () => number = Math.random
): number {
  if (attempt < 1) throw new Error('attempt must be >= 1');
  const base = opts.initialMs * Math.pow(opts.multiplier, attempt - 1);
  const jitter = (2 * rng() - 1) * opts.jitterRatio;
  return Math.round(base * (1 + jitter));
}
```

- [ ] **Step 7.4: Run test to verify it passes**

Run: `pnpm test tests/core/helpers/exponential-backoff.test.ts`
Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add src/core/helpers/exponential-backoff.ts tests/core/helpers/exponential-backoff.test.ts
git commit -m "feat(core): add computeBackoffMs helper"
```

- [ ] **Step 7.6: Draft PR を作成**

  `feature/phase2-task4__exponential-backoff` → `feature/phase2__core-modules__base` へ Draft PR を作成する。

---

### Task 5: Plugin interface + defineA2APlugin

> **ブランチ:** `feature/phase2-task5__plugin-interface` （`feature/phase2-task4__exponential-backoff` から派生）
> **PR:** → `feature/phase2__core-modules__base` (Draft)

**Files:**

- Create: `src/core/plugin-interface.ts`
- Create: `src/core/define-plugin.ts`
- Create: `src/index.ts`
- Create: `tests/core/define-plugin.test.ts`

- [ ] **Step 8.1: Write the failing test**

Create `tests/core/define-plugin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineA2APlugin } from '../../src/core/define-plugin.js';
import type { A2APluginInterface } from '../../src/core/plugin-interface.js';

describe('defineA2APlugin', () => {
  it('returns the input object unchanged and preserves typing', () => {
    const schema = z.object({ foo: z.string() });
    const plugin: A2APluginInterface<z.infer<typeof schema>> = {
      id: 'test',
      version: '0.0.1',
      configSchema: schema,
      async initialize() {},
      async dispose() {},
      async *execute() {},
      metadata: () => ({
        skill: { id: 'test', name: 'Test', description: 't' },
      }),
    };
    const defined = defineA2APlugin(plugin);
    expect(defined).toBe(plugin);
    expect(defined.id).toBe('test');
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `pnpm test tests/core/define-plugin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement `src/core/plugin-interface.ts`**

```ts
import type { z } from 'zod';
import type { Message, StreamResponse } from './a2a-types.js';
import type { Logger } from './logger.js';

export interface A2APluginContext {
  logger: Logger;
  abortSignal: AbortSignal;
  taskId: string;
  contextId?: string;
}

export interface A2APluginSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

export interface A2APluginInterface<TConfig = unknown> {
  readonly id: string;
  readonly version: string;
  readonly configSchema: z.ZodType<TConfig>;

  initialize(config: TConfig): Promise<void>;
  dispose(): Promise<void>;

  execute(
    message: Message,
    ctx: A2APluginContext
  ): AsyncIterable<StreamResponse>;

  metadata(): { skill: A2APluginSkill };
}
```

- [ ] **Step 8.4: Implement `src/core/define-plugin.ts`**

```ts
import type { A2APluginInterface } from './plugin-interface.js';

export function defineA2APlugin<TConfig>(
  def: A2APluginInterface<TConfig>
): A2APluginInterface<TConfig> {
  return def;
}
```

- [ ] **Step 8.5: Create initial `src/index.ts`**

```ts
export * from './core/a2a-types.js';
export * from './core/errors.js';
export * from './core/logger.js';
export * from './core/plugin-interface.js';
export * from './core/define-plugin.js';
```

- [ ] **Step 8.6: Run test to verify it passes**

Run: `pnpm test tests/core/define-plugin.test.ts && pnpm typecheck`
Expected: PASS + typecheck clean.

- [ ] **Step 8.7: Commit**

```bash
git add src/core/plugin-interface.ts src/core/define-plugin.ts src/index.ts tests/core/define-plugin.test.ts
git commit -m "feat(core): add A2APluginInterface + defineA2APlugin + public index"
```

- [ ] **Step 8.8: Draft PR を作成**

  `feature/phase2-task5__plugin-interface` → `feature/phase2__core-modules__base` へ Draft PR を作成する。

---

### Task 6: PluginRegistry

> **ブランチ:** `feature/phase2-task6__registry` （`feature/phase2-task5__plugin-interface` から派生）
> **PR:** → `feature/phase2__core-modules__base` (Draft)

**Files:**

- Create: `src/core/registry.ts`
- Create: `tests/core/registry.test.ts`

- [ ] **Step 9.1: Write the failing test**

Create `tests/core/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { PluginRegistry } from '../../src/core/registry.js';
import type { A2APluginInterface } from '../../src/core/plugin-interface.js';

function makePlugin(
  id: string,
  opts: { initSpy?: (c: unknown) => void } = {}
): A2APluginInterface {
  return {
    id,
    version: '0.0.1',
    configSchema: z.object({ foo: z.string().default('bar') }),
    async initialize(config) {
      opts.initSpy?.(config);
    },
    async dispose() {},
    async *execute() {},
    metadata: () => ({ skill: { id, name: id, description: '' } }),
  };
}

describe('PluginRegistry', () => {
  it('register + get + list', () => {
    const reg = new PluginRegistry();
    const p = makePlugin('gemini-cli');
    reg.register(p);
    expect(reg.get('gemini-cli')).toBe(p);
    expect(reg.list()).toEqual([p]);
    expect(reg.get('missing')).toBeUndefined();
  });

  it('throws on duplicate id', () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin('a'));
    expect(() => reg.register(makePlugin('a'))).toThrow(/duplicate/i);
  });

  it('initializeAll validates config via Zod and passes to plugin.initialize', async () => {
    const reg = new PluginRegistry();
    let seen: unknown;
    reg.register(makePlugin('x', { initSpy: (c) => (seen = c) }));
    await reg.initializeAll({ x: { foo: 'hello' } });
    expect(seen).toEqual({ foo: 'hello' });
  });

  it('initializeAll applies schema defaults when keys missing', async () => {
    const reg = new PluginRegistry();
    let seen: unknown;
    reg.register(makePlugin('y', { initSpy: (c) => (seen = c) }));
    await reg.initializeAll({});
    expect(seen).toEqual({ foo: 'bar' });
  });

  it('initializeAll throws if config fails Zod validation', async () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin('z'));
    await expect(reg.initializeAll({ z: { foo: 42 } })).rejects.toThrow();
  });

  it("disposeAll calls every plugin's dispose", async () => {
    const reg = new PluginRegistry();
    const disposed: string[] = [];
    const p1: A2APluginInterface = {
      ...makePlugin('p1'),
      dispose: async () => void disposed.push('p1'),
    };
    const p2: A2APluginInterface = {
      ...makePlugin('p2'),
      dispose: async () => void disposed.push('p2'),
    };
    reg.register(p1);
    reg.register(p2);
    await reg.disposeAll();
    expect(disposed).toEqual(['p1', 'p2']);
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

Run: `pnpm test tests/core/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement `src/core/registry.ts`**

```ts
import type { A2APluginInterface } from './plugin-interface.js';

export class PluginRegistry {
  private readonly plugins = new Map<string, A2APluginInterface>();

  register(plugin: A2APluginInterface): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`duplicate plugin id: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): A2APluginInterface | undefined {
    return this.plugins.get(id);
  }

  list(): A2APluginInterface[] {
    return [...this.plugins.values()];
  }

  async initializeAll(configs: Record<string, unknown>): Promise<void> {
    for (const plugin of this.plugins.values()) {
      const raw = configs[plugin.id] ?? {};
      const parsed = plugin.configSchema.parse(raw);
      await plugin.initialize(parsed);
    }
  }

  async disposeAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.dispose();
    }
  }
}
```

- [ ] **Step 9.4: Run test to verify it passes**

Run: `pnpm test tests/core/registry.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 9.5: Update `src/index.ts` to export registry**

```ts
export * from './core/a2a-types.js';
export * from './core/errors.js';
export * from './core/logger.js';
export * from './core/plugin-interface.js';
export * from './core/define-plugin.js';
export * from './core/registry.js';
```

- [ ] **Step 9.6: Commit**

```bash
git add src/core/registry.ts tests/core/registry.test.ts src/index.ts
git commit -m "feat(core): add PluginRegistry with Zod-validated initialization"
```

- [ ] **Step 9.7: Draft PR を作成**

  `feature/phase2-task6__registry` → `feature/phase2__core-modules__base` へ Draft PR を作成する。

---

### Task 7: TaskStore (interface + InMemoryTaskStore)

> **ブランチ:** `feature/phase2-task7__task-store` （`feature/phase2-task6__registry` から派生）
> **PR:** → `feature/phase2__core-modules__base` (Draft)

**Files:**

- Create: `src/core/task-store.ts`
- Create: `tests/core/task-store.test.ts`

- [ ] **Step 10.1: Write the failing test**

Create `tests/core/task-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryTaskStore } from '../../src/core/task-store.js';

describe('InMemoryTaskStore', () => {
  it('create produces a UUID id and PENDING status', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create({});
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.status.state).toBe('TASK_STATE_PENDING');
  });

  it('create preserves contextId', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create({ contextId: 'ctx-1' });
    expect(task.contextId).toBe('ctx-1');
  });

  it('get returns the stored task or undefined', async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    expect(await store.get(t.id)).toEqual(t);
    expect(await store.get('missing')).toBeUndefined();
  });

  it('update patches and returns new task', async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    const updated = await store.update(t.id, {
      status: { state: 'TASK_STATE_WORKING' },
    });
    expect(updated.status.state).toBe('TASK_STATE_WORKING');
    expect((await store.get(t.id))?.status.state).toBe('TASK_STATE_WORKING');
  });

  it('update throws if task missing', async () => {
    const store = new InMemoryTaskStore();
    await expect(
      store.update('nope', { status: { state: 'TASK_STATE_WORKING' } })
    ).rejects.toThrow();
  });

  it('appendArtifact accumulates artifacts', async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.appendArtifact(t.id, {
      artifactId: 'a1',
      parts: [{ kind: 'text', text: 'hello' }],
    });
    const got = await store.get(t.id);
    expect(got?.artifacts).toHaveLength(1);
    expect(got?.artifacts?.[0].artifactId).toBe('a1');
  });

  it('appendHistoryEntry accumulates status history', async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.appendHistoryEntry(t.id, { state: 'TASK_STATE_WORKING' });
    await store.appendHistoryEntry(t.id, { state: 'TASK_STATE_COMPLETED' });
    const got = await store.get(t.id);
    expect(got?.history).toHaveLength(2);
    expect(got?.history?.[1].state).toBe('TASK_STATE_COMPLETED');
  });

  it('appendStreamChunk dispatches artifact-update to artifacts, status-update to history', async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.appendStreamChunk(t.id, {
      kind: 'artifact-update',
      artifact: { artifactId: 'a1', parts: [{ kind: 'text', text: 'x' }] },
    });
    await store.appendStreamChunk(t.id, {
      kind: 'status-update',
      status: { state: 'TASK_STATE_WORKING' },
    });
    const got = await store.get(t.id);
    expect(got?.artifacts).toHaveLength(1);
    expect(got?.history).toHaveLength(1);
  });

  it('delete removes the task', async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.delete(t.id);
    expect(await store.get(t.id)).toBeUndefined();
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

Run: `pnpm test tests/core/task-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 10.3: Implement `src/core/task-store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type {
  Artifact,
  StreamResponse,
  Task,
  TaskStatus,
} from './a2a-types.js';

export interface TaskStore {
  create(init: { contextId?: string }): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  update(id: string, patch: Partial<Task>): Promise<Task>;
  appendArtifact(id: string, artifact: Artifact): Promise<void>;
  appendStreamChunk(id: string, chunk: StreamResponse): Promise<void>;
  appendHistoryEntry(id: string, status: TaskStatus): Promise<void>;
  delete(id: string): Promise<void>;
}

export class InMemoryTaskStore implements TaskStore {
  private readonly store = new Map<string, Task>();

  async create(init: { contextId?: string }): Promise<Task> {
    const task: Task = {
      id: randomUUID(),
      ...(init.contextId !== undefined ? { contextId: init.contextId } : {}),
      status: {
        state: 'TASK_STATE_PENDING',
        timestamp: new Date().toISOString(),
      },
    };
    this.store.set(task.id, task);
    return task;
  }

  async get(id: string): Promise<Task | undefined> {
    return this.store.get(id);
  }

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`task not found: ${id}`);
    const updated: Task = { ...existing, ...patch, id: existing.id };
    this.store.set(id, updated);
    return updated;
  }

  async appendArtifact(id: string, artifact: Artifact): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`task not found: ${id}`);
    existing.artifacts = [...(existing.artifacts ?? []), artifact];
  }

  async appendStreamChunk(id: string, chunk: StreamResponse): Promise<void> {
    if (chunk.kind === 'artifact-update') {
      await this.appendArtifact(id, chunk.artifact);
    } else if (chunk.kind === 'status-update') {
      await this.appendHistoryEntry(id, chunk.status);
    }
    // task/message chunks are not persisted here
  }

  async appendHistoryEntry(id: string, status: TaskStatus): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`task not found: ${id}`);
    existing.history = [...(existing.history ?? []), status];
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
```

- [ ] **Step 10.4: Run test to verify it passes**

Run: `pnpm test tests/core/task-store.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 10.5: Commit**

```bash
git add src/core/task-store.ts tests/core/task-store.test.ts
git commit -m "feat(core): add TaskStore interface + InMemoryTaskStore"
```

- [ ] **Step 10.6: Draft PR を作成**

  `feature/phase2-task7__task-store` → `feature/phase2__core-modules__base` へ Draft PR を作成する。

---

### Task 8: JSON-Lines subprocess helper

> **ブランチ:** `feature/phase2-task8__subprocess` （`feature/phase2-task7__task-store` から派生）
> **PR:** → `feature/phase2__core-modules__base` (Draft)

**Files:**

- Create: `src/core/helpers/subprocess.ts`
- Create: `tests/core/helpers/subprocess.test.ts`
- Create: `tests/fixtures/json-lines-echo.mjs`

- [ ] **Step 11.1: Create test fixture — `tests/fixtures/json-lines-echo.mjs`**

```js
#!/usr/bin/env node
// Reads one line from stdin; echoes N json-lines then exits.
// Usage: json-lines-echo.mjs <lines> [exitCode]
import { stdin, stdout, stderr, argv, exit } from 'node:process';

const lines = parseInt(argv[2] ?? '1', 10);
const exitCode = parseInt(argv[3] ?? '0', 10);
const failMode = argv[4]; // "stderr"|undefined

let buf = '';
stdin.on('data', (c) => (buf += c));
stdin.on('end', () => {
  for (let i = 0; i < lines; i++) {
    stdout.write(JSON.stringify({ index: i, input: buf.trim() }) + '\n');
  }
  if (failMode === 'stderr') stderr.write('bad things\n');
  exit(exitCode);
});
```

- [ ] **Step 11.2: Make fixture executable**

Run: `chmod +x tests/fixtures/json-lines-echo.mjs`

- [ ] **Step 11.3: Write the failing test**

Create `tests/core/helpers/subprocess.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runJsonLinesSubprocess } from '../../../src/core/helpers/subprocess.js';
import { SubprocessError } from '../../../src/core/errors.js';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/json-lines-echo.mjs', import.meta.url)
);

async function drain(it: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('runJsonLinesSubprocess', () => {
  it('yields parsed JSON lines in order', async () => {
    const ctl = new AbortController();
    const lines = await drain(
      runJsonLinesSubprocess({
        cmd: process.execPath,
        args: [FIXTURE, '3'],
        abortSignal: ctl.signal,
        stdin: 'hello',
      })
    );
    expect(lines).toHaveLength(3);
    expect((lines[0] as { index: number }).index).toBe(0);
    expect((lines[2] as { input: string }).input).toBe('hello');
  });

  it('throws SubprocessError on non-zero exit', async () => {
    const ctl = new AbortController();
    const it = runJsonLinesSubprocess({
      cmd: process.execPath,
      args: [FIXTURE, '1', '7', 'stderr'],
      abortSignal: ctl.signal,
      stdin: 'x',
    });
    await expect(drain(it)).rejects.toThrow(SubprocessError);
  });

  it('aborts via AbortSignal (sends SIGTERM)', async () => {
    const ctl = new AbortController();
    const it = runJsonLinesSubprocess({
      cmd: process.execPath,
      args: [FIXTURE, '1'],
      abortSignal: ctl.signal,
      stdin: 'x',
    });
    // Abort before stdin close would normally be consumed by kill
    queueMicrotask(() => ctl.abort());
    // Either throws or completes; key is it terminates quickly
    await expect(drain(it)).rejects.toThrow();
  }, 5000);
});
```

- [ ] **Step 11.4: Run test to verify it fails**

Run: `pnpm test tests/core/helpers/subprocess.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 11.5: Implement `src/core/helpers/subprocess.ts`**

```ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { SubprocessError } from '../errors.js';

export interface JsonLinesSubprocessOpts {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  abortSignal: AbortSignal;
  stdin?: string | Uint8Array;
  sigkillGraceMs?: number; // default 5000
}

export async function* runJsonLinesSubprocess(
  opts: JsonLinesSubprocessOpts
): AsyncIterable<unknown> {
  const child = spawn(opts.cmd, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderrBuf += chunk));

  const gracefulKill = () => {
    if (child.exitCode !== null || child.killed) return;
    child.kill('SIGTERM');
    const grace = opts.sigkillGraceMs ?? 5000;
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    }, grace).unref();
  };

  const onAbort = () => gracefulKill();
  opts.abortSignal.addEventListener('abort', onAbort, { once: true });

  if (opts.stdin !== undefined) {
    child.stdin.end(opts.stdin);
  } else {
    child.stdin.end();
  }

  const rl = createInterface({ input: child.stdout });

  const exitPromise = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 0));
  });

  try {
    for await (const line of rl) {
      if (line.trim() === '') continue;
      yield JSON.parse(line);
    }
    const exitCode = await exitPromise;
    if (opts.abortSignal.aborted) {
      throw new Error('aborted');
    }
    if (exitCode !== 0) {
      throw new SubprocessError(exitCode, stderrBuf);
    }
  } finally {
    opts.abortSignal.removeEventListener('abort', onAbort);
    gracefulKill();
  }
}
```

- [ ] **Step 11.6: Run test to verify it passes**

Run: `pnpm test tests/core/helpers/subprocess.test.ts`
Expected: PASS.

- [ ] **Step 11.7: Commit**

```bash
git add src/core/helpers/subprocess.ts tests/core/helpers/subprocess.test.ts tests/fixtures/json-lines-echo.mjs
git commit -m "feat(core): add runJsonLinesSubprocess helper with abort + SubprocessError"
```

- [ ] **Step 11.8: Draft PR を作成**

  `feature/phase2-task8__subprocess` → `feature/phase2__core-modules__base` へ Draft PR を作成する。

---

## Phase 3: TaskRunner

> **Phase ブランチ:** `feature/phase3__task-runner__base` （`master` から作成、Phase 2 の PR が `master` にマージ済みであること）
> **Phase PR:** `feature/phase3__task-runner__base` → `master` (Draft)

All Phase 3 tasks share the same `src/core/task-runner.ts` file. Each task adds **one behavior** (one or more test cases + the minimal implementation to pass them). Do NOT skip ahead; the discipline is one-behavior-at-a-time so the retry semantics get proved incrementally.

**Shared test helper** — create this ONCE at the start of Task 12 and reuse across tasks:

File: `tests/core/_helpers.ts`

```ts
import { z } from 'zod';
import type { A2APluginInterface } from '../../src/core/plugin-interface.js';
import type { Message, StreamResponse } from '../../src/core/a2a-types.js';
import { ConsoleLogger, type Logger } from '../../src/core/logger.js';

export function silentLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

export function mkMessage(): Message {
  return { role: 'ROLE_USER', parts: [{ kind: 'text', text: 'hi' }] };
}

export function mkPlugin(
  id: string,
  exec: (
    msg: Message,
    ctx: { abortSignal: AbortSignal }
  ) => AsyncIterable<StreamResponse>
): A2APluginInterface {
  return {
    id,
    version: '0.0.1',
    configSchema: z.object({}).passthrough(),
    async initialize() {},
    async dispose() {},
    execute: exec,
    metadata: () => ({ skill: { id, name: id, description: '' } }),
  };
}

export async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

export { ConsoleLogger };
```

---

### Task 1: TaskRunner — happy path (1st attempt success)

> **ブランチ:** `feature/phase3-task1__happy-path` （`feature/phase3__task-runner__base` から派生）
> **PR:** → `feature/phase3__task-runner__base` (Draft)

**Files:**

- Create: `src/core/task-runner.ts` (initial)
- Create: `tests/core/_helpers.ts` (from above)
- Create: `tests/core/task-runner.test.ts`

- [ ] **Step 12.1: Create `tests/core/_helpers.ts`** (copy the full file content from the "Shared test helper" section above)

- [ ] **Step 12.2: Write the failing test**

Create `tests/core/task-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../src/core/registry.js';
import { InMemoryTaskStore } from '../../src/core/task-store.js';
import { TaskRunner } from '../../src/core/task-runner.js';
import { drain, mkMessage, mkPlugin, silentLogger } from './_helpers.js';

describe('TaskRunner — happy path', () => {
  it('1 attempt success yields task → WORKING → chunks → COMPLETED', async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin('p', async function* () {
        yield {
          kind: 'artifact-update',
          artifact: { artifactId: 'a1', parts: [{ kind: 'text', text: 'ok' }] },
        };
      })
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 10,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(
      runner.run('p', mkMessage(), { abortSignal: ctl.signal })
    );

    const kinds = out.map((c) => c.kind);
    expect(kinds).toEqual([
      'task',
      'status-update',
      'artifact-update',
      'status-update',
    ]);
    const firstStatus = out[1] as { status: { state: string } };
    expect(firstStatus.status.state).toBe('TASK_STATE_WORKING');
    const lastStatus = out[3] as { status: { state: string } };
    expect(lastStatus.status.state).toBe('TASK_STATE_COMPLETED');
  });
});
```

- [ ] **Step 12.3: Run test to verify it fails**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 12.4: Implement minimal `src/core/task-runner.ts`**

```ts
import type { Message, StreamResponse, TaskStatus } from './a2a-types.js';
import type { A2APluginContext } from './plugin-interface.js';
import type { PluginRegistry } from './registry.js';
import type { TaskStore } from './task-store.js';
import type { Logger } from './logger.js';
import { NonRetriableError, serializeError } from './errors.js';
import { computeBackoffMs } from './helpers/exponential-backoff.js';

export interface TaskRunnerOptions {
  maxAttempts: number;
  initialBackoffMs: number;
  backoffMultiplier: number;
  jitterRatio: number;
  logger: Logger;
}

export class TaskRunner {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly taskStore: TaskStore,
    private readonly options: TaskRunnerOptions
  ) {}

  async *run(
    pluginId: string,
    message: Message,
    opts: { abortSignal: AbortSignal; contextId?: string }
  ): AsyncIterable<StreamResponse> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      // Will be extended in Task 18 to emit FAILED status update
      throw new NonRetriableError(`plugin not found: ${pluginId}`);
    }

    const task = await this.taskStore.create({
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    });
    yield { kind: 'task', task };

    const ctx: A2APluginContext = {
      logger: this.options.logger,
      abortSignal: opts.abortSignal,
      taskId: task.id,
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    };

    const workingStatus: TaskStatus = {
      state: 'TASK_STATE_WORKING',
      timestamp: new Date().toISOString(),
    };
    await this.taskStore.update(task.id, { status: workingStatus });
    await this.taskStore.appendHistoryEntry(task.id, workingStatus);
    yield { kind: 'status-update', status: workingStatus };

    for await (const chunk of plugin.execute(message, ctx)) {
      yield chunk;
      await this.taskStore.appendStreamChunk(task.id, chunk);
    }

    const completedStatus: TaskStatus = {
      state: 'TASK_STATE_COMPLETED',
      timestamp: new Date().toISOString(),
    };
    await this.taskStore.update(task.id, { status: completedStatus });
    await this.taskStore.appendHistoryEntry(task.id, completedStatus);
    yield { kind: 'status-update', status: completedStatus };
  }
}
```

Note: This minimal implementation does NOT yet handle retries, abort, or non-retriable errors. Those come in later tasks and each task will REFACTOR this file. The test suite is the executable definition of completeness.

- [ ] **Step 12.5: Run test to verify it passes**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: PASS — happy path test green.

- [ ] **Step 12.6: Commit**

```bash
git add src/core/task-runner.ts tests/core/_helpers.ts tests/core/task-runner.test.ts
git commit -m "feat(core): add TaskRunner happy path (1-attempt success)"
```

- [ ] **Step 12.7: Draft PR を作成**

  `feature/phase3-task1__happy-path` → `feature/phase3__task-runner__base` へ Draft PR を作成する。

---

### Task 2: TaskRunner — retry after pre-yield failure

> **ブランチ:** `feature/phase3-task2__retry` （`feature/phase3-task1__happy-path` から派生）
> **PR:** → `feature/phase3__task-runner__base` (Draft)

- [ ] **Step 13.1: Add failing test to `tests/core/task-runner.test.ts`**

Append inside the existing file:

```ts
describe('TaskRunner — retry before first yield', () => {
  it('retries on throw before first yield, succeeds on 2nd attempt, emits COMPLETED', async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin('retry-then-ok', async function* () {
        attempts++;
        if (attempts === 1) throw new Error('transient');
        yield {
          kind: 'artifact-update',
          artifact: { artifactId: 'a1', parts: [{ kind: 'text', text: 'ok' }] },
        };
      })
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(
      runner.run('retry-then-ok', mkMessage(), { abortSignal: ctl.signal })
    );
    expect(attempts).toBe(2);
    const lastStatus = out.at(-1) as {
      kind: 'status-update';
      status: { state: string };
    };
    expect(lastStatus.kind).toBe('status-update');
    expect(lastStatus.status.state).toBe('TASK_STATE_COMPLETED');
  });
});
```

- [ ] **Step 13.2: Run test — confirm new test fails, old tests still pass**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: happy-path test PASS, retry test FAIL.

- [ ] **Step 13.3: Refactor `src/core/task-runner.ts` to add retry loop**

Replace the `run` method body with:

```ts
  async *run(
    pluginId: string,
    message: Message,
    opts: { abortSignal: AbortSignal; contextId?: string },
  ): AsyncIterable<StreamResponse> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new NonRetriableError(`plugin not found: ${pluginId}`);
    }

    const task = await this.taskStore.create({
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    });
    yield { kind: "task", task };

    const ctx: A2APluginContext = {
      logger: this.options.logger,
      abortSignal: opts.abortSignal,
      taskId: task.id,
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    };

    let lastError: unknown;
    let firstYielded = false;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        for await (const chunk of plugin.execute(message, ctx)) {
          if (!firstYielded) {
            firstYielded = true;
            const workingStatus: TaskStatus = {
              state: "TASK_STATE_WORKING",
              timestamp: new Date().toISOString(),
            };
            await this.taskStore.update(task.id, { status: workingStatus });
            await this.taskStore.appendHistoryEntry(task.id, workingStatus);
            yield { kind: "status-update", status: workingStatus };
          }
          yield chunk;
          await this.taskStore.appendStreamChunk(task.id, chunk);
        }
        const completedStatus: TaskStatus = {
          state: "TASK_STATE_COMPLETED",
          timestamp: new Date().toISOString(),
        };
        await this.taskStore.update(task.id, { status: completedStatus });
        await this.taskStore.appendHistoryEntry(task.id, completedStatus);
        yield { kind: "status-update", status: completedStatus };
        return;
      } catch (err) {
        lastError = err;
        this.options.logger.warn("plugin execute failed", {
          taskId: task.id,
          pluginId,
          attempt,
          error: serializeError(err).message,
        });
        if (firstYielded) break;
        if (attempt < this.options.maxAttempts) {
          await this.sleep(
            computeBackoffMs(attempt, {
              initialMs: this.options.initialBackoffMs,
              multiplier: this.options.backoffMultiplier,
              jitterRatio: this.options.jitterRatio,
            }),
          );
        }
      }
    }

    const failed: TaskStatus = {
      state: "TASK_STATE_FAILED",
      timestamp: new Date().toISOString(),
      message: serializeError(lastError).message,
    };
    await this.taskStore.update(task.id, { status: failed });
    await this.taskStore.appendHistoryEntry(task.id, failed);
    yield { kind: "status-update", status: failed };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
```

- [ ] **Step 13.4: Run all TaskRunner tests**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: all tests PASS (both happy path and retry).

- [ ] **Step 13.5: Commit**

```bash
git add src/core/task-runner.ts tests/core/task-runner.test.ts
git commit -m "feat(core): TaskRunner retries on pre-yield failures"
```

- [ ] **Step 13.6: Draft PR を作成**

  `feature/phase3-task2__retry` → `feature/phase3__task-runner__base` へ Draft PR を作成する。

---

### Task 3: TaskRunner — 3 consecutive failures → FAILED

> **ブランチ:** `feature/phase3-task3__all-fail` （`feature/phase3-task2__retry` から派生）
> **PR:** → `feature/phase3__task-runner__base` (Draft)

- [ ] **Step 14.1: Add failing test**

Append to `tests/core/task-runner.test.ts`:

```ts
describe('TaskRunner — all attempts fail', () => {
  it('after maxAttempts fails, emits FAILED with error in status.message', async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin('always-fail', async function* () {
        attempts++;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _: never = undefined as never;
        throw new Error(`boom-${attempts}`);
      })
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(
      runner.run('always-fail', mkMessage(), { abortSignal: ctl.signal })
    );
    expect(attempts).toBe(3);

    const last = out.at(-1) as {
      kind: 'status-update';
      status: { state: string; message?: string };
    };
    expect(last.status.state).toBe('TASK_STATE_FAILED');
    expect(last.status.message).toMatch(/boom-3/);
  });
});
```

- [ ] **Step 14.2: Run tests**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: new test PASS (the retry loop from Task 13 already covers it).

- [ ] **Step 14.3: Commit**

```bash
git add tests/core/task-runner.test.ts
git commit -m "test(core): add 3-attempts-fail → FAILED test for TaskRunner"
```

- [ ] **Step 14.4: Draft PR を作成**

  `feature/phase3-task3__all-fail` → `feature/phase3__task-runner__base` へ Draft PR を作成する。

---

### Task 4: TaskRunner — AbortSignal before execute → CANCELED

> **ブランチ:** `feature/phase3-task4__abort-before` （`feature/phase3-task3__all-fail` から派生）
> **PR:** → `feature/phase3__task-runner__base` (Draft)

- [ ] **Step 15.1: Add failing test**

Append:

```ts
describe('TaskRunner — cancellation before start', () => {
  it('if abortSignal is already aborted, emits CANCELED without calling plugin', async () => {
    let calls = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin('never', async function* () {
        calls++;
      })
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    ctl.abort();
    const out = await drain(
      runner.run('never', mkMessage(), { abortSignal: ctl.signal })
    );
    expect(calls).toBe(0);
    const last = out.at(-1) as {
      kind: 'status-update';
      status: { state: string };
    };
    expect(last.status.state).toBe('TASK_STATE_CANCELED');
  });
});
```

- [ ] **Step 15.2: Run to see failure**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: new test FAIL (current code calls plugin regardless).

- [ ] **Step 15.3: Update `src/core/task-runner.ts` — add abort check at loop start**

Inside the `for` loop, at the top, add:

```ts
      if (opts.abortSignal.aborted) {
        const canceled: TaskStatus = {
          state: "TASK_STATE_CANCELED",
          timestamp: new Date().toISOString(),
        };
        await this.taskStore.update(task.id, { status: canceled });
        await this.taskStore.appendHistoryEntry(task.id, canceled);
        yield { kind: "status-update", status: canceled };
        return;
      }
```

So the loop begins:

```ts
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      if (opts.abortSignal.aborted) {
        const canceled: TaskStatus = {
          state: "TASK_STATE_CANCELED",
          timestamp: new Date().toISOString(),
        };
        await this.taskStore.update(task.id, { status: canceled });
        await this.taskStore.appendHistoryEntry(task.id, canceled);
        yield { kind: "status-update", status: canceled };
        return;
      }
      try {
        // ... existing body ...
```

- [ ] **Step 15.4: Run tests**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: all tests PASS.

- [ ] **Step 15.5: Commit**

```bash
git add src/core/task-runner.ts tests/core/task-runner.test.ts
git commit -m "feat(core): TaskRunner emits CANCELED when abort precedes execute"
```

- [ ] **Step 15.6: Draft PR を作成**

  `feature/phase3-task4__abort-before` → `feature/phase3__task-runner__base` へ Draft PR を作成する。

---

### Task 5: TaskRunner — abort during streaming → CANCELED

> **ブランチ:** `feature/phase3-task5__abort-mid-stream` （`feature/phase3-task4__abort-before` から派生）
> **PR:** → `feature/phase3__task-runner__base` (Draft)

- [ ] **Step 16.1: Add failing test**

Append:

```ts
describe('TaskRunner — cancellation mid-stream', () => {
  it('when abort fires while plugin is yielding, run terminates with CANCELED', async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    const ctl = new AbortController();
    registry.register(
      mkPlugin('slow', async function* (_m, ctx) {
        yield {
          kind: 'artifact-update',
          artifact: {
            artifactId: 'a1',
            parts: [{ kind: 'text', text: 'part1' }],
          },
        };
        // Simulate work that respects abort
        await new Promise<void>((resolve, reject) => {
          if (ctx.abortSignal.aborted) return reject(new Error('aborted'));
          ctx.abortSignal.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true }
          );
          setTimeout(resolve, 500);
        });
        yield {
          kind: 'artifact-update',
          artifact: {
            artifactId: 'a2',
            parts: [{ kind: 'text', text: 'part2' }],
          },
        };
      })
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });

    queueMicrotask(() => ctl.abort());
    const out = await drain(
      runner.run('slow', mkMessage(), { abortSignal: ctl.signal })
    );
    const last = out.at(-1) as {
      kind: 'status-update';
      status: { state: string };
    };
    expect(last.status.state).toBe('TASK_STATE_CANCELED');
  });
});
```

- [ ] **Step 16.2: Run tests — observe current behavior**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: likely FAIL — the aborted stream throws, current code will treat as post-yield failure → FAILED, not CANCELED.

- [ ] **Step 16.3: Update `src/core/task-runner.ts` — distinguish abort from error in catch block**

Replace the `catch` block with:

```ts
      } catch (err) {
        if (opts.abortSignal.aborted) {
          const canceled: TaskStatus = {
            state: "TASK_STATE_CANCELED",
            timestamp: new Date().toISOString(),
          };
          await this.taskStore.update(task.id, { status: canceled });
          await this.taskStore.appendHistoryEntry(task.id, canceled);
          yield { kind: "status-update", status: canceled };
          return;
        }
        lastError = err;
        this.options.logger.warn("plugin execute failed", {
          taskId: task.id,
          pluginId,
          attempt,
          error: serializeError(err).message,
        });
        if (firstYielded) break;
        if (attempt < this.options.maxAttempts) {
          await this.sleep(
            computeBackoffMs(attempt, {
              initialMs: this.options.initialBackoffMs,
              multiplier: this.options.backoffMultiplier,
              jitterRatio: this.options.jitterRatio,
            }),
          );
        }
      }
```

- [ ] **Step 16.4: Run tests**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: all PASS.

- [ ] **Step 16.5: Commit**

```bash
git add src/core/task-runner.ts tests/core/task-runner.test.ts
git commit -m "feat(core): TaskRunner emits CANCELED on mid-stream abort"
```

- [ ] **Step 16.6: Draft PR を作成**

  `feature/phase3-task5__abort-mid-stream` → `feature/phase3__task-runner__base` へ Draft PR を作成する。

---

### Task 6: TaskRunner — post-yield error does NOT retry

> **ブランチ:** `feature/phase3-task6__post-yield-no-retry` （`feature/phase3-task5__abort-mid-stream` から派生）
> **PR:** → `feature/phase3__task-runner__base` (Draft)

- [ ] **Step 17.1: Add failing test**

Append:

```ts
describe('TaskRunner — post-yield error does not retry', () => {
  it('failure after first yield triggers FAILED without retry', async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin('yield-then-fail', async function* () {
        attempts++;
        yield {
          kind: 'artifact-update',
          artifact: {
            artifactId: 'a1',
            parts: [{ kind: 'text', text: 'partial' }],
          },
        };
        throw new Error('after-yield-boom');
      })
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(
      runner.run('yield-then-fail', mkMessage(), { abortSignal: ctl.signal })
    );
    expect(attempts).toBe(1); // no retry
    const last = out.at(-1) as {
      kind: 'status-update';
      status: { state: string; message?: string };
    };
    expect(last.status.state).toBe('TASK_STATE_FAILED');
    expect(last.status.message).toMatch(/after-yield-boom/);
  });
});
```

- [ ] **Step 17.2: Run tests — confirm behavior already correct (due to `if (firstYielded) break;` from Task 13)**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: test PASS — behavior was already enforced earlier; this is a regression test.

- [ ] **Step 17.3: Commit**

```bash
git add tests/core/task-runner.test.ts
git commit -m "test(core): pin post-yield-error-no-retry semantics"
```

- [ ] **Step 17.4: Draft PR を作成**

  `feature/phase3-task6__post-yield-no-retry` → `feature/phase3__task-runner__base` へ Draft PR を作成する。

---

### Task 7: TaskRunner — NonRetriableError and missing plugin → FAILED (no retry)

> **ブランチ:** `feature/phase3-task7__non-retriable` （`feature/phase3-task6__post-yield-no-retry` から派生）
> **PR:** → `feature/phase3__task-runner__base` (Draft)

- [ ] **Step 18.1: Add failing test**

Append:

```ts
describe('TaskRunner — non-retriable errors', () => {
  it('emits FAILED without retry when plugin throws NonRetriableError', async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin('permanent', async function* () {
        attempts++;
        throw new NonRetriableError('bad-config');
      })
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(
      runner.run('permanent', mkMessage(), { abortSignal: ctl.signal })
    );
    expect(attempts).toBe(1);
    const last = out.at(-1) as {
      kind: 'status-update';
      status: { state: string; message?: string };
    };
    expect(last.status.state).toBe('TASK_STATE_FAILED');
    expect(last.status.message).toMatch(/bad-config/);
  });

  it('missing plugin id yields { kind: task } then FAILED (not an uncaught throw)', async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(
      runner.run('nope', mkMessage(), { abortSignal: ctl.signal })
    );
    const kinds = out.map((c) => c.kind);
    expect(kinds[0]).toBe('task');
    const last = out.at(-1) as {
      kind: 'status-update';
      status: { state: string; message?: string };
    };
    expect(last.status.state).toBe('TASK_STATE_FAILED');
    expect(last.status.message).toMatch(/plugin not found/i);
  });
});
```

Also add this import at the top of the test file:

```ts
import { NonRetriableError } from '../../src/core/errors.js';
```

- [ ] **Step 18.2: Run tests — confirm failures**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: new tests FAIL (current code throws on missing plugin instead of emitting FAILED; also NonRetriableError currently retries).

- [ ] **Step 18.3: Update `src/core/task-runner.ts`**

Replace the `run` method entirely with this version (task now handles missing-plugin + NonRetriableError):

```ts
  async *run(
    pluginId: string,
    message: Message,
    opts: { abortSignal: AbortSignal; contextId?: string },
  ): AsyncIterable<StreamResponse> {
    const task = await this.taskStore.create({
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    });
    yield { kind: "task", task };

    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      yield* this.emitFailed(task.id, new NonRetriableError(`plugin not found: ${pluginId}`));
      return;
    }

    const ctx: A2APluginContext = {
      logger: this.options.logger,
      abortSignal: opts.abortSignal,
      taskId: task.id,
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    };

    let lastError: unknown;
    let firstYielded = false;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      if (opts.abortSignal.aborted) {
        yield* this.emitTerminal(task.id, "TASK_STATE_CANCELED");
        return;
      }
      try {
        for await (const chunk of plugin.execute(message, ctx)) {
          if (!firstYielded) {
            firstYielded = true;
            yield* this.emitWorking(task.id);
          }
          yield chunk;
          await this.taskStore.appendStreamChunk(task.id, chunk);
        }
        yield* this.emitTerminal(task.id, "TASK_STATE_COMPLETED");
        return;
      } catch (err) {
        if (opts.abortSignal.aborted) {
          yield* this.emitTerminal(task.id, "TASK_STATE_CANCELED");
          return;
        }
        lastError = err;
        this.options.logger.warn("plugin execute failed", {
          taskId: task.id,
          pluginId,
          attempt,
          error: serializeError(err).message,
        });
        if (err instanceof NonRetriableError) break;
        if (firstYielded) break;
        if (attempt < this.options.maxAttempts) {
          await this.sleep(
            computeBackoffMs(attempt, {
              initialMs: this.options.initialBackoffMs,
              multiplier: this.options.backoffMultiplier,
              jitterRatio: this.options.jitterRatio,
            }),
          );
        }
      }
    }

    yield* this.emitFailed(task.id, lastError);
  }

  private async *emitWorking(taskId: string): AsyncIterable<StreamResponse> {
    const status: TaskStatus = {
      state: "TASK_STATE_WORKING",
      timestamp: new Date().toISOString(),
    };
    await this.taskStore.update(taskId, { status });
    await this.taskStore.appendHistoryEntry(taskId, status);
    yield { kind: "status-update", status };
  }

  private async *emitTerminal(
    taskId: string,
    state: "TASK_STATE_COMPLETED" | "TASK_STATE_CANCELED",
  ): AsyncIterable<StreamResponse> {
    const status: TaskStatus = { state, timestamp: new Date().toISOString() };
    await this.taskStore.update(taskId, { status });
    await this.taskStore.appendHistoryEntry(taskId, status);
    yield { kind: "status-update", status };
  }

  private async *emitFailed(taskId: string, err: unknown): AsyncIterable<StreamResponse> {
    const status: TaskStatus = {
      state: "TASK_STATE_FAILED",
      timestamp: new Date().toISOString(),
      message: serializeError(err).message,
    };
    await this.taskStore.update(taskId, { status });
    await this.taskStore.appendHistoryEntry(taskId, status);
    yield { kind: "status-update", status };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
```

- [ ] **Step 18.4: Run full TaskRunner suite**

Run: `pnpm test tests/core/task-runner.test.ts`
Expected: ALL TaskRunner tests PASS (happy, retry-then-ok, 3-fails-FAILED, abort-before, abort-mid, post-yield-no-retry, NonRetriable, plugin-missing).

- [ ] **Step 18.5: Update `src/index.ts` to export new symbols**

```ts
export * from './core/a2a-types.js';
export * from './core/errors.js';
export * from './core/logger.js';
export * from './core/plugin-interface.js';
export * from './core/define-plugin.js';
export * from './core/registry.js';
export * from './core/task-store.js';
export * from './core/task-runner.js';
```

- [ ] **Step 18.6: Typecheck + full test run**

Run: `pnpm typecheck && pnpm test`
Expected: clean typecheck + all tests green.

- [ ] **Step 18.7: Commit**

```bash
git add src/core/task-runner.ts src/index.ts tests/core/task-runner.test.ts
git commit -m "feat(core): TaskRunner handles NonRetriableError and missing plugin without retry"
```

- [ ] **Step 18.8: Draft PR を作成**

  `feature/phase3-task7__non-retriable` → `feature/phase3__task-runner__base` へ Draft PR を作成する。

---

## Phase 4: 設定とプラグイン

> **Phase ブランチ:** `feature/phase4__config-and-plugin__base` （`master` から作成、Phase 3 の PR が `master` にマージ済みであること）
> **Phase PR:** `feature/phase4__config-and-plugin__base` → `master` (Draft)

### Task 1: ConfigLoader

> **ブランチ:** `feature/phase4-task1__config-loader` （`feature/phase4__config-and-plugin__base` から派生）
> **PR:** → `feature/phase4__config-and-plugin__base` (Draft)

- [ ] **Step 19.1: Create fixture — `tests/fixtures/config.test.json`**

```json
{
  "plugins": {
    "gemini-cli": {
      "cliPath": "gemini",
      "model": "gemini-2.5-pro",
      "apiKey": "${env:FAKE_GEMINI_API_KEY}"
    }
  }
}
```

- [ ] **Step 19.2: Write the failing test**

Create `tests/core/config-loader.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/core/config-loader.js';

const FIXTURE = fileURLToPath(
  new URL('../fixtures/config.test.json', import.meta.url)
);

describe('loadConfig', () => {
  const original = process.env.FAKE_GEMINI_API_KEY;
  beforeEach(() => {
    process.env.FAKE_GEMINI_API_KEY = 'secret-123';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.FAKE_GEMINI_API_KEY;
    else process.env.FAKE_GEMINI_API_KEY = original;
  });

  it('reads JSON and resolves ${env:VAR} placeholders', async () => {
    const cfg = await loadConfig(FIXTURE);
    expect(cfg.plugins['gemini-cli'].apiKey).toBe('secret-123');
    expect(cfg.plugins['gemini-cli'].model).toBe('gemini-2.5-pro');
  });

  it('throws when ${env:VAR} is not set', async () => {
    delete process.env.FAKE_GEMINI_API_KEY;
    await expect(loadConfig(FIXTURE)).rejects.toThrow(/FAKE_GEMINI_API_KEY/);
  });

  it('returns an empty plugins map for a missing file', async () => {
    const cfg = await loadConfig('/tmp/does-not-exist-opencode-a2a.json');
    expect(cfg.plugins).toEqual({});
  });
});
```

- [ ] **Step 19.3: Run test to verify it fails**

Run: `pnpm test tests/core/config-loader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 19.4: Implement `src/core/config-loader.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const A2AConfigSchema = z.object({
  plugins: z.record(z.record(z.unknown())).default({}),
});

export type A2AConfig = z.infer<typeof A2AConfigSchema>;

const ENV_PLACEHOLDER = /^\$\{env:([A-Z_][A-Z0-9_]*)\}$/;

export async function loadConfig(path: string): Promise<A2AConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return A2AConfigSchema.parse({});
    }
    throw err;
  }
  const parsed = JSON.parse(raw);
  const resolved = resolveEnv(parsed);
  return A2AConfigSchema.parse(resolved);
}

function resolveEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    const m = ENV_PLACEHOLDER.exec(value);
    if (!m) return value;
    const name = m[1]!;
    const v = process.env[name];
    if (v === undefined) throw new Error(`env var not set: ${name}`);
    return v;
  }
  if (Array.isArray(value)) return value.map(resolveEnv);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveEnv(v);
    }
    return out;
  }
  return value;
}
```

- [ ] **Step 19.5: Run tests**

Run: `pnpm test tests/core/config-loader.test.ts`
Expected: PASS.

- [ ] **Step 19.6: Update `src/index.ts`**

Append:

```ts
export * from './core/config-loader.js';
```

- [ ] **Step 19.7: Commit**

```bash
git add src/core/config-loader.ts tests/core/config-loader.test.ts tests/fixtures/config.test.json src/index.ts
git commit -m "feat(core): add loadConfig with env placeholder resolution"
```

- [ ] **Step 19.8: Draft PR を作成**

  `feature/phase4-task1__config-loader` → `feature/phase4__config-and-plugin__base` へ Draft PR を作成する。

---

### Task 2: GeminiCliPlugin — unit (config + metadata)

> **ブランチ:** `feature/phase4-task2__gemini-unit` （`feature/phase4-task1__config-loader` から派生）
> **PR:** → `feature/phase4__config-and-plugin__base` (Draft)

**Files:**

- Create: `src/plugins/gemini-cli-plugin.ts`
- Create: `tests/plugins/gemini-cli-plugin.test.ts`

This task covers initialization + metadata only; execution (which spawns a subprocess) is covered as an integration test in Task 3.

- [ ] **Step 20.1: Write the failing test**

Create `tests/plugins/gemini-cli-plugin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  GeminiCliPlugin,
  GeminiConfigSchema,
} from '../../src/plugins/gemini-cli-plugin.js';

describe('GeminiCliPlugin — config + metadata', () => {
  it('has the expected id/version', () => {
    const p = new GeminiCliPlugin();
    expect(p.id).toBe('gemini-cli');
    expect(p.version).toMatch(/^0\.\d+\.\d+$/);
  });

  it('config defaults: cliPath=gemini, model=gemini-2.5-pro', () => {
    const parsed = GeminiConfigSchema.parse({});
    expect(parsed.cliPath).toBe('gemini');
    expect(parsed.model).toBe('gemini-2.5-pro');
    expect(parsed.apiKey).toBeUndefined();
  });

  it('metadata exposes skill with tags', () => {
    const p = new GeminiCliPlugin();
    const { skill } = p.metadata();
    expect(skill.id).toBe('gemini-cli');
    expect(skill.tags).toContain('code');
  });

  it('initialize accepts validated config without throwing', async () => {
    const p = new GeminiCliPlugin();
    const cfg = GeminiConfigSchema.parse({ cliPath: '/bin/echo', model: 'x' });
    await expect(p.initialize(cfg)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 20.2: Run to verify fail**

Run: `pnpm test tests/plugins/gemini-cli-plugin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 20.3: Implement `src/plugins/gemini-cli-plugin.ts`**

```ts
import { z } from 'zod';
import type {
  A2APluginContext,
  A2APluginInterface,
} from '../core/plugin-interface.js';
import type { Message, StreamResponse } from '../core/a2a-types.js';
import { NonRetriableError } from '../core/errors.js';
import { runJsonLinesSubprocess } from '../core/helpers/subprocess.js';

export const GeminiConfigSchema = z.object({
  cliPath: z.string().default('gemini'),
  model: z.string().default('gemini-2.5-pro'),
  workingDir: z.string().optional(),
  apiKey: z.string().optional(),
});
export type GeminiConfig = z.infer<typeof GeminiConfigSchema>;

export class GeminiCliPlugin implements A2APluginInterface<GeminiConfig> {
  readonly id = 'gemini-cli';
  readonly version = '0.1.0';
  readonly configSchema = GeminiConfigSchema;

  private config: GeminiConfig | null = null;

  async initialize(config: GeminiConfig): Promise<void> {
    this.config = config;
  }

  async dispose(): Promise<void> {
    this.config = null;
  }

  async *execute(
    message: Message,
    ctx: A2APluginContext
  ): AsyncIterable<StreamResponse> {
    if (!this.config) {
      throw new NonRetriableError('GeminiCliPlugin not initialized');
    }
    const prompt = messageToPrompt(message);

    const env: Record<string, string> = {};
    if (this.config.apiKey) env.GEMINI_API_KEY = this.config.apiKey;

    const proc = runJsonLinesSubprocess({
      cmd: this.config.cliPath,
      args: ['--json', '--model', this.config.model, '-'],
      ...(this.config.workingDir !== undefined
        ? { cwd: this.config.workingDir }
        : {}),
      env,
      abortSignal: ctx.abortSignal,
      stdin: prompt,
    });

    for await (const line of proc) {
      const evt = parseGeminiEvent(line);
      if (evt) yield evt;
    }
  }

  metadata() {
    return {
      skill: {
        id: 'gemini-cli',
        name: 'Gemini CLI',
        description: 'Delegates to Google Gemini CLI',
        tags: ['code', 'chat', 'search'],
        examples: ['Generate a React component', 'Summarize this file'],
      },
    };
  }
}

function messageToPrompt(m: Message): string {
  return m.parts
    .map((p) => (p.kind === 'text' ? p.text : JSON.stringify(p)))
    .join('\n');
}

type GeminiEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'error'; message: string }
  | { type: string; [k: string]: unknown };

function parseGeminiEvent(raw: unknown): StreamResponse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const ev = raw as GeminiEvent;
  switch (ev.type) {
    case 'text':
      return {
        kind: 'artifact-update',
        artifact: {
          artifactId: 'gemini-out',
          parts: [{ kind: 'text', text: ev.text }],
        },
      };
    case 'thinking':
      return null; // headless principle: do not leak internal reasoning
    case 'error':
      throw new Error(`gemini: ${ev.message}`);
    default:
      return null;
  }
}
```

- [ ] **Step 20.4: Run tests + typecheck**

Run: `pnpm test tests/plugins/gemini-cli-plugin.test.ts && pnpm typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 20.5: Commit**

```bash
git add src/plugins/gemini-cli-plugin.ts tests/plugins/gemini-cli-plugin.test.ts
git commit -m "feat(plugins): add GeminiCliPlugin (config + metadata + execute skeleton)"
```

- [ ] **Step 20.6: Draft PR を作成**

  `feature/phase4-task2__gemini-unit` → `feature/phase4__config-and-plugin__base` へ Draft PR を作成する。

---

### Task 3: GeminiCliPlugin — integration test with fake CLI

> **ブランチ:** `feature/phase4-task3__gemini-integration` （`feature/phase4-task2__gemini-unit` から派生）
> **PR:** → `feature/phase4__config-and-plugin__base` (Draft)

**Files:**

- Create: `tests/fixtures/fake-gemini-cli.mjs`
- Create: `tests/integration/gemini-cli-plugin.test.ts`

- [ ] **Step 21.1: Create fake CLI — `tests/fixtures/fake-gemini-cli.mjs`**

```js
#!/usr/bin/env node
// Minimal Gemini-style JSON-Lines emitter for integration tests.
// Reads prompt from stdin, emits a "text" event echoing the prompt,
// plus a "thinking" event (to exercise the filter), then exits 0.
import { stdin, stdout, exit } from 'node:process';

let buf = '';
stdin.on('data', (c) => (buf += c));
stdin.on('end', () => {
  stdout.write(JSON.stringify({ type: 'thinking', text: 'pondering' }) + '\n');
  stdout.write(
    JSON.stringify({ type: 'text', text: `echo: ${buf.trim()}` }) + '\n'
  );
  exit(0);
});
```

- [ ] **Step 21.2: Make executable**

Run: `chmod +x tests/fixtures/fake-gemini-cli.mjs`

- [ ] **Step 21.3: Write integration test**

Create `tests/integration/gemini-cli-plugin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  GeminiCliPlugin,
  GeminiConfigSchema,
} from '../../src/plugins/gemini-cli-plugin.js';
import { silentLogger, drain, mkMessage } from '../core/_helpers.js';
import type { StreamResponse } from '../../src/core/a2a-types.js';

const FAKE_CLI = fileURLToPath(
  new URL('../fixtures/fake-gemini-cli.mjs', import.meta.url)
);

describe('GeminiCliPlugin (integration)', () => {
  it('executes fake CLI and yields text as artifact-update, drops thinking', async () => {
    const plugin = new GeminiCliPlugin();
    const cfg = GeminiConfigSchema.parse({
      cliPath: process.execPath, // node binary
      model: 'fake-model',
    });
    await plugin.initialize(cfg);

    // Override: plugin will run process.execPath --json --model fake-model -
    // Need the CLI path to include the script. Simpler: pass the script as cliPath
    // by re-initializing with a shell wrapper. But the plugin spawns `cmd args`,
    // so to run a script we set cliPath to node and inject the script via args.
    // To keep the plugin unchanged, we'll use cliPath=fake-cli-script directly.
    await plugin.initialize(
      GeminiConfigSchema.parse({ cliPath: FAKE_CLI, model: 'fake-model' })
    );

    const ctl = new AbortController();
    const out = (await drain(
      plugin.execute(mkMessage(), {
        logger: silentLogger(),
        abortSignal: ctl.signal,
        taskId: 't-1',
      })
    )) as StreamResponse[];

    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('artifact-update');
    if (out[0].kind === 'artifact-update') {
      const part = out[0].artifact.parts[0];
      expect(part.kind).toBe('text');
      if (part.kind === 'text') {
        expect(part.text).toMatch(/^echo: hi/);
      }
    }
  });
});
```

- [ ] **Step 21.4: Run test**

Run: `pnpm test tests/integration/gemini-cli-plugin.test.ts`
Expected: PASS.

- [ ] **Step 21.5: Run full suite + coverage**

Run: `pnpm test:coverage`
Expected: all tests PASS; core modules hit >95% line coverage.

- [ ] **Step 21.6: Commit**

```bash
git add tests/fixtures/fake-gemini-cli.mjs tests/integration/gemini-cli-plugin.test.ts
git commit -m "test(plugins): integration test for GeminiCliPlugin with fake CLI"
```

- [ ] **Step 21.7: Draft PR を作成**

  `feature/phase4-task3__gemini-integration` → `feature/phase4__config-and-plugin__base` へ Draft PR を作成する。

---

## Self-Review

**Spec coverage check** (spec section → Phase/Task):

- §2 Architecture / directory layout → P1-T1–T3, P2-T1–T8, P4-T1–T2.
- §3.1 a2a-types.ts (Zod) → P2-T3.
- §3.2 plugin-interface.ts → P2-T5.
- §3.3 define-plugin.ts → P2-T5.
- §3.4 registry.ts → P2-T6.
- §4 TaskRunner (retry, states, abort, non-retriable) → P3-T1–T7.
- §4.6 Logger → P2-T2.
- §5 HTTP server / SSE / AgentCard / Bearer → **DEFERRED to follow-up plan**.
- §6.1 TaskStore → P2-T7.
- §6.2 subprocess helper → P2-T8.
- §6.3 GeminiCliPlugin → P4-T2–T3.
- §6.4 ConfigLoader → P4-T1.
- §7 Devcontainer → P1-T2.
- §8 Test strategy → P2–P4 (each behavior has targeted test).
- §9 CI → P0-T1.
- §11 Deliverables → P1-T2, P2-T3, P2-T5, P3-T1–T7, P4-T2.
- §12 Residual risks → P2-T2 (secret masking), P2-T3 (protocol version), P2-T8 (SIGKILL grace).

**ブランチ運用確認:**

- 全 Phase ブランチは `master` から作成され、`master` への Draft PR を持つ。
- 各 Task ブランチは直前の Task から派生（Phase 内最初の Task は Phase base から派生）。
- 全 Task の最終ステップに Draft PR 作成アクションが含まれている。
- Phase 0 (CI/CD) が計画の先頭に配置されている。
- CI ランナーは `ubuntu-slim` を使用。
- CI トリガーは `master` ブランチを対象。

**Placeholder scan:** No `TBD`, `TODO`, or "similar to Task N" stubs. Every step has complete code.

**Type consistency check:**

- `A2APluginInterface` signature fixed in P2-T5 and referenced unchanged in P2-T6, P3-T1, P4-T2.
- `TaskStore.appendStreamChunk` signature fixed in P2-T7 and used in TaskRunner (P3-T1–T7).
- `computeBackoffMs` signature fixed in P2-T4 and used in P3-T2.
- `runJsonLinesSubprocess` signature fixed in P2-T8 and used in P4-T2.
- `NonRetriableError` defined in P2-T1 and used in P3-T7, P4-T2.
- `mkPlugin` / `drain` / `silentLogger` helpers defined in P3-T1's `_helpers.ts` and reused in P3-T2–T7, P4-T3.

**Scope check:** This plan targets the core library + one plugin example + devcontainer + CI. HTTP server layer (`src/server/*`) is explicitly deferred. A follow-up plan titled `2026-04-24-opencode-a2a-server-adapter.md` (or similar) will implement §5 of the spec.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-opencode-a2a-core.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach would you like?
