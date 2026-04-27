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

    // Verify persistence
    const taskId = (out[0] as any).task.id;
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
    // We can't easily get the taskId from 'run()' because it threw,
    // but we know it's the only task in the store.
    const tasks = (store as any).store.values();
    const task = tasks.next().value;
    expect(task.status.state).toBe("TASK_STATE_FAILED");
    expect(task.statusHistory?.[task.statusHistory.length - 1].state).toBe("TASK_STATE_FAILED");
  });

  it("does not overwrite terminal/special state set by plugin", async () => {
    const registry = new PluginRegistry();
    const store = new InMemoryTaskStore();
    registry.register(
      mkPlugin("p", async function* (msg, ctx) {
        // Simulating a plugin that requires input
        const inputRequired: any = {
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

    const statusUpdates = out.filter((c) => c.kind === "status-update") as any[];
    // Should be: WORKING -> INPUT_REQUIRED (from plugin)
    // Should NOT have COMPLETED at the end
    expect(statusUpdates.map((s) => s.status.state)).toEqual([
      "TASK_STATE_WORKING",
      "TASK_STATE_INPUT_REQUIRED",
    ]);

    const taskId = (out[0] as any).task.id;
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

    const taskId = (out[0] as any).task.id;
    const persisted = await store.get(taskId);
    expect(persisted?.status.state).toBe("TASK_STATE_COMPLETED");
    expect(persisted?.history).toHaveLength(1);
    expect(persisted?.history?.[0].parts[0]).toEqual({ kind: "text", text: "thought: processing..." });
  });
});
