import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskStore } from '../../src/core/task-store.js';
import type { Artifact } from '../../src/core/a2a-types.js';

describe('InMemoryTaskStore', () => {
  let store: InMemoryTaskStore;

  beforeEach(() => {
    store = new InMemoryTaskStore();
  });

  describe('create', () => {
    it('should create task with pending state', async () => {
      const task = await store.create({});
      expect(task.id).toBeDefined();
      expect(task.status.state).toBe('TASK_STATE_PENDING');
    });

    it('should create task with contextId', async () => {
      const task = await store.create({ contextId: 'ctx-123' });
      expect(task.contextId).toBe('ctx-123');
    });
  });

  describe('get', () => {
    it('should return task by id', async () => {
      const created = await store.create({});
      const fetched = await store.get(created.id);
      expect(fetched?.id).toBe(created.id);
    });

    it('should return undefined for unknown id', async () => {
      const fetched = await store.get('unknown');
      expect(fetched).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update task status', async () => {
      const created = await store.create({});
      const updated = await store.update(created.id, {
        status: { state: 'TASK_STATE_WORKING', timestamp: new Date().toISOString() },
      });
      expect(updated.status.state).toBe('TASK_STATE_WORKING');
    });
  });

  describe('appendArtifact', () => {
    it('should append artifact to task', async () => {
      const created = await store.create({});
      const artifact: Artifact = {
        artifactId: 'art-1',
        parts: [{ kind: 'text', text: 'Hello' }],
      };

      await store.appendArtifact(created.id, artifact);
      const fetched = await store.get(created.id);
      expect(fetched?.artifacts).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('should delete task', async () => {
      const created = await store.create({});
      await store.delete(created.id);
      const fetched = await store.get(created.id);
      expect(fetched).toBeUndefined();
    });
  });
});
