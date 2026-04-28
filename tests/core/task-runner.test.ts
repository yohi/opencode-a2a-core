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
      maxBackoffMs: 1000,
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
      maxBackoffMs: 1000,
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
      maxBackoffMs: 1000,
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
      maxBackoffMs: 1000,
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
      maxBackoffMs: 1000,
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
      maxBackoffMs: 1000,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    await expect(drain(runner.run("no-retry", mkMessage(), { abortSignal: ctl.signal }))).rejects.toThrow("fatal");
    expect(attempts).toBe(1);
  });

  it("aborts sleep when AbortSignal is triggered and sets CANCELED status", async () => {
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
      maxBackoffMs: 5000,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const runPromise = drain(runner.run("long-retry", mkMessage(), { abortSignal: ctl.signal }));

    // Wait a bit for the first attempt to fail and enter sleep
    await new Promise((r) => setTimeout(r, 100));
    ctl.abort("user cancel");

    const events = await runPromise;
    const lastEvent = events[events.length - 1];
    expect(lastEvent.kind).toBe("status-update");
    if (lastEvent.kind === "status-update") {
      expect(lastEvent.status.state).toBe("TASK_STATE_CANCELED");
    }

    // Verify status is updated to CANCELED in store
    const tasks = (store as unknown as { store: Map<string, Task> }).store.values();
    const task = tasks.next().value;
    if (!task) throw new Error("task not found in store");
    expect(task.status.state).toBe("TASK_STATE_CANCELED");
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
      maxBackoffMs: 1000,
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

    const last = out.at(-1) as { kind: "status-update"; status: TaskStatus };
    expect(last.kind).toBe("status-update");
    expect(last.status.state).toBe("TASK_STATE_FAILED");
    expect((last.status.message?.parts[0] as any).text).toMatch(/boom-3/);
  });
});

describe("TaskRunner — cancellation before start", () => {
  it("if abortSignal is already aborted, emits CANCELED without calling plugin", async () => {
    let calls = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      // eslint-disable-next-line require-yield
      mkPlugin("never", async function* () {
        calls++;
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      maxBackoffMs: 1000,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    ctl.abort();
    const out = await drain(runner.run("never", mkMessage(), { abortSignal: ctl.signal }));
    expect(calls).toBe(0);

    const taskId = (out[0] as { task: { id: string } }).task.id;
    const persisted = await store.get(taskId);
    expect(persisted?.status.state).toBe("TASK_STATE_CANCELED");

    const last = out.at(-1) as { kind: "status-update"; status: { state: string } };
    expect(last.kind).toBe("status-update");
    expect(last.status.state).toBe("TASK_STATE_CANCELED");
  });
});

describe("TaskRunner — cancellation mid-stream", () => {
  it("when abort fires while plugin is yielding, run terminates with CANCELED", async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    const ctl = new AbortController();
    registry.register(
      mkPlugin("slow", async function* (_m, ctx) {
        yield {
          kind: "artifact-update",
          artifact: { artifactId: "a1", parts: [{ kind: "text", text: "part1" }] },
        };
        // Simulate work that respects abort
        await new Promise<void>((resolve, reject) => {
          if (ctx.abortSignal.aborted) return reject(new Error("aborted"));
          ctx.abortSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          setTimeout(resolve, 500);
        });
        yield {
          kind: "artifact-update",
          artifact: { artifactId: "a2", parts: [{ kind: "text", text: "part2" }] },
        };
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      maxBackoffMs: 1000,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });

    const out: any[] = [];
    for await (const chunk of runner.run("slow", mkMessage(), { abortSignal: ctl.signal })) {
      out.push(chunk);
      if (chunk.kind === "artifact-update") {
        ctl.abort();
      }
    }

    const last = out.at(-1) as { kind: "status-update"; status: { state: string } };
    expect(last.status.state).toBe("TASK_STATE_CANCELED");

    // Verify persistence in store
    const task = await store.get(out[0].task.id);
    expect(task?.status.state).toBe("TASK_STATE_CANCELED");
  });
});

describe("TaskRunner — post-yield error does not retry", () => {
  it("failure after first yield triggers FAILED without retry", async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin("yield-then-fail", async function* () {
        attempts++;
        yield {
          kind: "artifact-update",
          artifact: { artifactId: "a1", parts: [{ kind: "text", text: "partial" }] },
        };
        throw new Error("after-yield-boom");
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      maxBackoffMs: 1000,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out: StreamResponse[] = [];
    const runPromise = (async () => {
      for await (const chunk of runner.run("yield-then-fail", mkMessage(), { abortSignal: ctl.signal })) {
        out.push(chunk);
      }
    })();

    await expect(runPromise).rejects.toThrow("after-yield-boom");
    expect(attempts).toBe(1); // no retry

    const last = out.at(-1);
    if (!last || last.kind !== "status-update") {
      throw new Error("Expected last chunk to be status-update");
    }
    expect(last.status.state).toBe("TASK_STATE_FAILED");
    expect((last.status.message?.parts[0] as any).text).toMatch(/after-yield-boom/);

    // Verify persistence in store
    const firstChunk = out[0];
    if (!firstChunk || firstChunk.kind !== "task") {
      throw new Error("Expected first chunk to be 'task'");
    }
    const task = await store.get(firstChunk.task.id);
    expect(task?.status.state).toBe("TASK_STATE_FAILED");
  });
});

describe("TaskRunner — non-retriable errors", () => {
  it("emits FAILED without retry when plugin throws NonRetriableError", async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin("permanent", async function* () {
        attempts++;
        throw new NonRetriableError("bad-config");
      }),
    );
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      maxBackoffMs: 1000,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out: StreamResponse[] = [];
    const runPromise = (async () => {
      for await (const chunk of runner.run("permanent", mkMessage(), { abortSignal: ctl.signal })) {
        out.push(chunk);
      }
    })();
    await expect(runPromise).rejects.toThrow("bad-config");
    expect(attempts).toBe(1);
    const last = out.at(-1) as { kind: "status-update"; status: TaskStatus };
    expect(last.status.state).toBe("TASK_STATE_FAILED");
    expect((last.status.message?.parts[0] as any).text).toMatch(/bad-config/);
  });

  it("missing plugin id yields { kind: task } then FAILED (not an uncaught throw)", async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 3,
      initialBackoffMs: 1,
      maxBackoffMs: 1000,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(runner.run("nope", mkMessage(), { abortSignal: ctl.signal }));
    const kinds = out.map((c) => c.kind);
    expect(kinds[0]).toBe("task");
    const last = out.at(-1) as { kind: "status-update"; status: TaskStatus };
    expect(last.status.state).toBe("TASK_STATE_FAILED");
    expect((last.status.message?.parts[0] as any).text).toMatch(/plugin not found/i);
  });

  it("throws error immediately if maxAttempts is 0 or less", async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    const runner = new TaskRunner(registry, store, {
      maxAttempts: 0,
      initialBackoffMs: 1,
      maxBackoffMs: 1000,
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    await expect(drain(runner.run("any", mkMessage(), { abortSignal: ctl.signal }))).rejects.toThrow(
      "maxAttempts must be a positive integer",
    );
  });
});
