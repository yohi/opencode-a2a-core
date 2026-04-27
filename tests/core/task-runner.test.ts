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
