import { describe, it, expect } from "vitest";
import { InMemoryTaskStore } from "../../src/core/task-store.js";

describe("InMemoryTaskStore", () => {
  it("create produces a UUID id and PENDING status", async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create({});
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.status.state).toBe("TASK_STATE_PENDING");
  });

  it("create preserves contextId", async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create({ contextId: "ctx-1" });
    expect(task.contextId).toBe("ctx-1");
  });

  it("get returns the stored task or undefined", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    expect(await store.get(t.id)).toEqual(t);
    expect(await store.get("missing")).toBeUndefined();
  });

  it("update patches and returns new task", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    const updated = await store.update(t.id, {
      status: { state: "TASK_STATE_WORKING" },
    });
    expect(updated.status.state).toBe("TASK_STATE_WORKING");
    expect((await store.get(t.id))?.status.state).toBe("TASK_STATE_WORKING");
  });

  it("update throws if task missing", async () => {
    const store = new InMemoryTaskStore();
    await expect(store.update("nope", { status: { state: "TASK_STATE_WORKING" } })).rejects.toThrow();
  });

  it("appendArtifact accumulates artifacts", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.appendArtifact(t.id, {
      artifactId: "a1",
      parts: [{ kind: "text", text: "hello" }],
    });
    const got = await store.get(t.id);
    expect(got?.artifacts).toHaveLength(1);
    expect(got?.artifacts?.[0].artifactId).toBe("a1");
  });

  it("appendHistoryEntry accumulates status history", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.appendHistoryEntry(t.id, { state: "TASK_STATE_WORKING" });
    await store.appendHistoryEntry(t.id, { state: "TASK_STATE_COMPLETED" });
    const got = await store.get(t.id);
    expect(got?.history).toHaveLength(2);
    expect(got?.history?.[1].state).toBe("TASK_STATE_COMPLETED");
  });

  it("delete removes the task", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.delete(t.id);
    expect(await store.get(t.id)).toBeUndefined();
  });
});
