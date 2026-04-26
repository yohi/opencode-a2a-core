import type { Task, TaskStatus, Artifact, StreamResponse } from './a2a-types.js';
import { TaskNotFoundError } from './errors.js';

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
  private tasks = new Map<string, Task>();
  private history = new Map<string, TaskStatus[]>();
  private chunks = new Map<string, StreamResponse[]>();

  async create(init: { contextId?: string }): Promise<Task> {
    const task: Task = {
      id: crypto.randomUUID(),
      contextId: init.contextId,
      status: {
        state: 'TASK_STATE_PENDING',
        timestamp: new Date().toISOString(),
      },
    };
    this.tasks.set(task.id, task);
    this.history.set(task.id, []);
    this.chunks.set(task.id, []);
    return task;
  }

  async get(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new TaskNotFoundError(id);
    }
    const updated = { ...existing, ...patch };
    this.tasks.set(id, updated);
    return updated;
  }

  async appendArtifact(id: string, artifact: Artifact): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    const artifacts = task.artifacts ?? [];
    artifacts.push(artifact);
    this.tasks.set(id, { ...task, artifacts });
  }

  async appendStreamChunk(id: string, chunk: StreamResponse): Promise<void> {
    const chunks = this.chunks.get(id);
    if (!chunks) {
      throw new TaskNotFoundError(id);
    }
    chunks.push(chunk);
  }

  async appendHistoryEntry(id: string, status: TaskStatus): Promise<void> {
    const entries = this.history.get(id);
    if (!entries) {
      throw new TaskNotFoundError(id);
    }
    entries.push(status);
  }

  async delete(id: string): Promise<void> {
    this.tasks.delete(id);
    this.history.delete(id);
    this.chunks.delete(id);
  }
}
