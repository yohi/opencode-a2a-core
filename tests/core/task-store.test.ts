import { describe, it, expect } from "vitest";
import { InMemoryTaskStore } from "../../src/core/task-store.js";
import type { Artifact, TaskStatus, StreamResponse } from "../../src/core/a2a-types.js";

describe("InMemoryTaskStore", () => {
  it("create produces a UUID id and PENDING status", async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create({});
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
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

  it("update patches and returns new task, preserving nested status fields", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    const originalTimestamp = t.status.timestamp;
    expect(originalTimestamp).toBeDefined();

    const updated = await store.update(t.id, {
      status: { state: "TASK_STATE_WORKING" },
    });
    
    expect(updated.status.state).toBe("TASK_STATE_WORKING");
    expect(updated.status.timestamp).toBe(originalTimestamp); // Should be preserved
    
    const got = await store.get(t.id);
    expect(got?.status.state).toBe("TASK_STATE_WORKING");
    expect(got?.status.timestamp).toBe(originalTimestamp);
  });

  it("update throws if task missing", async () => {
    const store = new InMemoryTaskStore();
    await expect(
      store.update("nope", { status: { state: "TASK_STATE_WORKING" } })
    ).rejects.toThrow(/task not found/);
  });

  it("appendArtifact protects against input mutation", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    const artifact: Artifact = {
      artifactId: "a1",
      parts: [{ kind: "text", text: "original" }],
    };
    await store.appendArtifact(t.id, artifact);
    
    // Mutate input object
    artifact.parts[0] = { kind: "text", text: "mutated" };
    
    const got = await store.get(t.id);
    const part = got?.artifacts?.[0].parts[0];
    expect(part?.kind).toBe("text");
    if (part?.kind === "text") {
      expect(part.text).toBe("original");
    }
  });

  it("updateStatus protects against input mutation", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    const status: TaskStatus = {
      state: "TASK_STATE_WORKING",
      message: { role: "ROLE_USER", parts: [{ kind: "text", text: "hello" }] },
    };
    await store.updateStatus(t.id, status);

    // Mutate input object deep
    const originalPart = status.message?.parts[0];
    if (originalPart?.kind === "text") {
      // Use explicit interface for mutation to avoid 'any'
      interface MutableText { text: string }
      (originalPart as unknown as MutableText).text = "mutated";
    }

    const got = await store.get(t.id);
    
    // Define validation logic that works on the Message structure
    const assertMessageIntegrity = (msg: { parts: { kind: string; text?: string }[] } | undefined) => {
      expect(msg).toBeDefined();
      const part = msg!.parts[0];
      expect(part.kind).toBe("text");
      expect(part.text).toBe("hello");
    };

    assertMessageIntegrity(got?.status.message);
    assertMessageIntegrity(got?.statusHistory?.[0].message);
    assertMessageIntegrity(got?.history?.[0]);
  });

  it("appendStreamChunk throws on unhandled kinds", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    
    // Using a non-existent kind to trigger error
    const chunk = { 
      kind: "unknown-kind", 
      data: {}
    } as unknown as StreamResponse;
    
    await expect(store.appendStreamChunk(t.id, chunk)).rejects.toThrow(/Unhandled stream chunk kind "unknown-kind"/);
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

  it("updateStatus updates current status and accumulates history", async () => {
    const store = new InMemoryTaskStore();
    const t = await store.create({});
    await store.updateStatus(t.id, { state: "TASK_STATE_WORKING" });
    const mid = await store.get(t.id);
    expect(mid?.status.state).toBe("TASK_STATE_WORKING");
    expect(mid?.statusHistory).toHaveLength(1);

    await store.updateStatus(t.id, {
      state: "TASK_STATE_FAILED",
      message: { role: "ROLE_AGENT", parts: [{ kind: "text", text: "err" }] },
    });

    const final = await store.get(t.id);
    expect(final?.status.state).toBe("TASK_STATE_FAILED");
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
