import { describe, it, expect } from "vitest";
import { InMemoryTaskStore } from "../../src/core/task-store.js";

describe("InMemoryTaskStore", () => {
  it("create produces a UUID id and PENDING status", async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create({});
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.status.state).toBe("TASK_STATE_PENDING");
  });

  it("create returns a defensive copy", async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create({});
    task.status.state = "TASK_STATE_COMPLETED"; // direct mutation

    const got = await store.get(task.id);
    expect(got?.status.state).toBe("TASK_STATE_PENDING"); // should remain unchanged in store
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

  it("get returns a defensive copy", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    const got1 = await store.get(t.id);
    if (got1) {
      got1.id = "modified";
    }
    const got2 = await store.get(t.id);
    expect(got2?.id).toBe(t.id);
  });

  it("appendHistoryEntry updates current status and accumulates history", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.appendHistoryEntry(t.id, { state: "TASK_STATE_WORKING" });
    const mid = await store.get(t.id);
    expect(mid?.status.state).toBe("TASK_STATE_WORKING");
    expect(mid?.statusHistory).toHaveLength(1);

    await store.appendHistoryEntry(t.id, {
      state: "TASK_STATE_COMPLETED",
      message: { role: "ROLE_AGENT", parts: [{ kind: "text", text: "done" }] },
    });
    const final = await store.get(t.id);
    expect(final?.status.state).toBe("TASK_STATE_COMPLETED");
    expect(final?.statusHistory).toHaveLength(2);
    expect(final?.history).toHaveLength(1);
    expect(final?.history?.[0].parts[0].kind).toBe("text");
  });

  it("delete removes the task or throws if missing", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.delete(t.id);
    expect(await store.get(t.id)).toBeUndefined();
    await expect(store.delete(t.id)).rejects.toThrow(/task not found/);
  });
});
