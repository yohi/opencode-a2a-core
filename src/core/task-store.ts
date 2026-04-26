import { randomUUID } from "node:crypto";
import type { Task, TaskStatus, Artifact, StreamResponse } from "./a2a-types.js";

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
      status: { state: "TASK_STATE_PENDING", timestamp: new Date().toISOString() },
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
    if (chunk.kind === "artifact-update") {
      await this.appendArtifact(id, chunk.artifact);
    } else if (chunk.kind === "status-update") {
      await this.appendHistoryEntry(id, chunk.status);
    }
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
