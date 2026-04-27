import { describe, it, expect } from "vitest";
import { PluginRegistry } from "../../src/core/registry.js";
import { InMemoryTaskStore } from "../../src/core/task-store.js";
import { TaskRunner } from "../../src/core/task-runner.js";
import { drain, mkMessage, mkPlugin, silentLogger } from "./_helpers.js";
import type { Task, TaskStatus, StreamResponse } from "../../src/core/a2a-types.js";
import { NonRetriableError } from "../../src/core/errors.js";

describe("TaskRunner — happy path", () => {
  it("1 attempt success yields task → WORKING → chunks → COMPLETED", async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin("p", async function* () {
        yield {
          kind: "artifact-update",
          artifact: { artifactId: "a1", parts: [{ kind: "text", text: "ok" }] },
        };
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 10,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(runner.run("p", mkMessage(), { abortSignal: ctl.signal }));

    const kinds = out.map((c) => c.kind);
    expect(kinds).toEqual(["task", "status-update", "artifact-update", "status-update"]);
    const firstStatus = out[1] as { status: { state: string } };
    expect(firstStatus.status.state).toBe("TASK_STATE_WORKING");
    const lastStatus = out[3] as { status: { state: string } };
    expect(lastStatus.status.state).toBe("TASK_STATE_COMPLETED");

    // Verify persistence
    const taskId = (out[0] as { task: { id: string } }).task.id;
    const persisted = await store.get(taskId);
    expect(persisted?.status.state).toBe("TASK_STATE_COMPLETED");
    expect(persisted?.statusHistory).toHaveLength(2);
    expect(persisted?.statusHistory?.[0].state).toBe("TASK_STATE_WORKING");
    expect(persisted?.statusHistory?.[1].state).toBe("TASK_STATE_COMPLETED");
  });

  it("failure in plugin yields task → WORKING → FAILED and persists it", async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      // eslint-disable-next-line require-yield
      mkPlugin("p", async function* () {
        throw new Error("boom");
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 1,
      initialBackoffMs: 10,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const run = () => drain(runner.run("p", mkMessage(), { abortSignal: ctl.signal }));

    await expect(run()).rejects.toThrow("boom");

    // Since it threw, we need to inspect the store manually.
    const tasks = (store as unknown as { store: Map<string, Task> }).store.values();
    const task = tasks.next().value;
    if (!task) throw new Error("task not found in store");
    expect(task.status.state).toBe("TASK_STATE_FAILED");
    expect(task.statusHistory?.[0].state).toBe("TASK_STATE_WORKING");
    expect(task.statusHistory?.[task.statusHistory.length - 1].state).toBe("TASK_STATE_FAILED");
  });

  it("does not overwrite terminal/special state set by plugin", async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin("p", async function* () {
        // Simulating a plugin that requires input
        const inputRequired: TaskStatus = {
          state: "TASK_STATE_INPUT_REQUIRED",
          timestamp: new Date().toISOString(),
        };
        // We use the store directly or via a chunk (appendStreamChunk handles status-update)
        yield { kind: "status-update", status: inputRequired };
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 1,
      initialBackoffMs: 10,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(runner.run("p", mkMessage(), { abortSignal: ctl.signal }));

    const statusUpdates = out.filter((c) => c.kind === "status-update") as { status: { state: string } }[];
    // Should be: WORKING -> INPUT_REQUIRED (from plugin)
    // Should NOT have COMPLETED at the end
    expect(statusUpdates.map((s) => s.status.state)).toEqual([
      "TASK_STATE_WORKING",
      "TASK_STATE_INPUT_REQUIRED",
    ]);

    const taskId = (out[0] as { task: { id: string } }).task.id;
    const persisted = await store.get(taskId);
    expect(persisted?.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
  });

  it("handles 'message' chunks and persists them to history", async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin("p", async function* () {
        yield {
          kind: "message",
          message: {
            role: "ROLE_AGENT",
            parts: [{ kind: "text", text: "thought: processing..." }],
          },
        };
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 1,
      initialBackoffMs: 10,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(runner.run("p", mkMessage(), { abortSignal: ctl.signal }));

    expect(out.some((c) => c.kind === "message")).toBe(true);

    const taskId = (out[0] as { task: { id: string } }).task.id;
    const persisted = await store.get(taskId);
    expect(persisted?.status.state).toBe("TASK_STATE_COMPLETED");
    expect(persisted?.history).toHaveLength(1);
    expect(persisted?.history?.[0].parts[0]).toEqual({ kind: "text", text: "thought: processing..." });
  });
});

describe("TaskRunner — retries and errors", () => {
  it("retries on throw before first yield, succeeds on 2nd attempt, emits COMPLETED", async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin("retry-then-ok", async function* () {
        attempts++;
        if (attempts === 1) throw new Error("transient");
        yield {
          kind: "artifact-update",
          artifact: { artifactId: "a1", parts: [{ kind: "text", text: "ok" }] },
        };
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(runner.run("retry-then-ok", mkMessage(), { abortSignal: ctl.signal }));
    expect(attempts).toBe(2);
    const lastStatus = out.at(-1) as { kind: "status-update"; status: { state: string } };
    expect(lastStatus.kind).toBe("status-update");
    expect(lastStatus.status.state).toBe("TASK_STATE_COMPLETED");
  });

  it("does NOT retry if NonRetriableError is thrown", async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      // eslint-disable-next-line require-yield
      mkPlugin("no-retry", async function* () {
        attempts++;
        throw new NonRetriableError("fatal");
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    await expect(drain(runner.run("no-retry", mkMessage(), { abortSignal: ctl.signal }))).rejects.toThrow("fatal");
    expect(attempts).toBe(1);
  });

  it("aborts sleep when AbortSignal is triggered and sets FAILED status", async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      // eslint-disable-next-line require-yield
      mkPlugin("long-retry", async function* () {
        throw new Error("fail");
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1000, // Long sleep
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const runPromise = drain(runner.run("long-retry", mkMessage(), { abortSignal: ctl.signal }));

    // Wait a bit for the first attempt to fail and enter sleep
    await new Promise((r) => setTimeout(r, 100));
    ctl.abort("user cancel");

    await expect(runPromise).rejects.toBe("user cancel");

    // Verify status is updated to FAILED in store
    const tasks = (store as unknown as { store: Map<string, Task> }).store.values();
    const task = tasks.next().value;
    if (!task) throw new Error("task not found in store");
    expect(task.status.state).toBe("TASK_STATE_FAILED");
    expect(task.status.message).toBe("user cancel");
  });
});

describe("TaskRunner — all attempts fail", () => {
  it("after maxAttempts fails, emits FAILED with error in status.message", async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      // eslint-disable-next-line require-yield
      mkPlugin("always-fail", async function* () {
        attempts++;
        throw new Error(`boom-${attempts}`);
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();

    const out: StreamResponse[] = [];
    const runPromise = (async () => {
      for await (const chunk of runner.run("always-fail", mkMessage(), { abortSignal: ctl.signal })) {
        out.push(chunk);
      }
    })();

    await expect(runPromise).rejects.toThrow(/boom-3/);
    expect(attempts).toBe(3);

    const last = out.at(-1) as { kind: "status-update"; status: { state: string; message?: string } };
    expect(last.kind).toBe("status-update");
    expect(last.status.state).toBe("TASK_STATE_FAILED");
    expect(last.status.message).toMatch(/boom-3/);
  });
});

describe("TaskRunner — cancellation before start", () => {
  it("if abortSignal is already aborted, emits CANCELED without calling plugin", async () => {
    let calls = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin("never", async function* () {
        calls++;
      }),
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
    const out = await drain(runner.run("never", mkMessage(), { abortSignal: ctl.signal }));
    expect(calls).toBe(0);
    const last = out.at(-1) as { kind: "status-update"; status: { state: string } };
    expect(last.status.state).toBe("TASK_STATE_CANCELED");
  });
});
