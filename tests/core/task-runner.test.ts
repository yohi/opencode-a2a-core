import { describe, it, expect } from "vitest";
import { PluginRegistry } from "../../src/core/registry.js";
import { InMemoryTaskStore } from "../../src/core/task-store.js";
import { TaskRunner } from "../../src/core/task-runner.js";
import { drain, mkMessage, mkPlugin, silentLogger } from "./_helpers.js";

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
  });
});

describe("TaskRunner — retry before first yield", () => {
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
});

describe("TaskRunner — all attempts fail", () => {
  it("after maxAttempts fails, emits FAILED with error in status.message", async () => {
    let attempts = 0;
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin("always-fail", async function* () {
        attempts++;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _: never = undefined as never;
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
    const out = await drain(runner.run("always-fail", mkMessage(), { abortSignal: ctl.signal }));
    expect(attempts).toBe(3);

    const last = out.at(-1) as { kind: "status-update"; status: { state: string; message?: string } };
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
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });

    queueMicrotask(() => ctl.abort());
    const out = await drain(runner.run("slow", mkMessage(), { abortSignal: ctl.signal }));
    const last = out.at(-1) as { kind: "status-update"; status: { state: string } };
    expect(last.status.state).toBe("TASK_STATE_CANCELED");
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
      backoffMultiplier: 2,
      jitterRatio: 0,
      logger: silentLogger(),
    });
    const ctl = new AbortController();
    const out = await drain(runner.run("yield-then-fail", mkMessage(), { abortSignal: ctl.signal }));
    expect(attempts).toBe(1); // no retry
    const last = out.at(-1) as { kind: "status-update"; status: { state: string; message?: string } };
    expect(last.status.state).toBe("TASK_STATE_FAILED");
    expect(last.status.message).toMatch(/after-yield-boom/);
  });
});
