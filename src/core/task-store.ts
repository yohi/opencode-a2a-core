import { randomUUID } from "node:crypto";
import type { Task, TaskStatus, Artifact, StreamResponse } from "./a2a-types.js";

export interface TaskStore {
  create(init: { contextId?: string }): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  update(id: string, patch: Partial<Task>): Promise<Task>;
  appendArtifact(id: string, artifact: Artifact): Promise<void>;
  appendStreamChunk(id: string, chunk: StreamResponse): Promise<void>;
  appendHistoryEntry(id: string, status: TaskStatus): Promise<void>;
  updateStatus(id: string, status: TaskStatus): Promise<void>;
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
    // Store a clone to prevent external mutation if 'task' were somehow shared
    this.store.set(task.id, structuredClone(task));
    return structuredClone(task);
  }

  async get(id: string): Promise<Task | undefined> {
    const task = this.store.get(id);
    return task ? structuredClone(task) : undefined;
  }

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`task not found: ${id}`);
    
    const clonedPatch = structuredClone(patch);
    
    // Merge into a new object. 
    // If patch contains status, merge it with existing status.
    const updated: Task = { 
      ...existing, 
      ...clonedPatch,
      status: clonedPatch.status 
        ? { ...existing.status, ...clonedPatch.status }
        : existing.status,
      id: existing.id // protect ID
    };
    this.store.set(id, structuredClone(updated));
    return structuredClone(updated);
  }

  async appendArtifact(id: string, artifact: Artifact): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`task not found: ${id}`);
    // Store a clone of the artifact
    existing.artifacts = [...(existing.artifacts ?? []), structuredClone(artifact)];
  }

  async appendStreamChunk(id: string, chunk: StreamResponse): Promise<void> {
    if (chunk.kind === "artifact-update") {
      await this.appendArtifact(id, chunk.artifact);
    } else if (chunk.kind === "status-update") {
      await this.appendHistoryEntry(id, chunk.status);
    } else {
      throw new Error(`Unhandled stream chunk kind "${chunk.kind}" for task ${id}`);
    }
  }

  async appendHistoryEntry(id: string, status: TaskStatus): Promise<void> {
    await this.updateStatus(id, status);
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`task not found: ${id}`);

    const clonedStatus = structuredClone(status);

    // Update current status
    existing.status = clonedStatus;

    // Record status history
    existing.statusHistory = [...(existing.statusHistory ?? []), clonedStatus];

    // Record message to history if present
    if (clonedStatus.message) {
      existing.history = [...(existing.history ?? []), clonedStatus.message];
    }
  }

  async delete(id: string): Promise<void> {
    const deleted = this.store.delete(id);
    if (!deleted) throw new Error(`task not found: ${id}`);
  }
}
