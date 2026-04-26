import type { PluginRegistry } from './registry.js';
import type { TaskStore } from './task-store.js';
import type { Logger } from './logger.js';
import type { Message, StreamResponse, TaskStatus, TaskState } from './a2a-types.js';
import { NonRetriableError, PluginNotFoundError } from './errors.js';

export interface TaskRunnerOptions {
  maxAttempts: number;
  initialBackoffMs: number;
  backoffMultiplier: number;
  jitterRatio: number;
  logger: Logger;
}

export class TaskRunner {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly taskStore: TaskStore,
    private readonly options: TaskRunnerOptions,
  ) {}

  async *run(
    pluginId: string,
    message: Message,
    opts: { abortSignal: AbortSignal; contextId?: string },
  ): AsyncIterable<StreamResponse> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new PluginNotFoundError(pluginId);
    }

    const task = await this.taskStore.create({ contextId: opts.contextId });
    yield {
      kind: 'task',
      task,
    };

    let lastError: unknown;
    let firstYield = true;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      if (opts.abortSignal.aborted) {
        await this.taskStore.update(task.id, {
          status: { state: 'TASK_STATE_CANCELED' as TaskState, timestamp: new Date().toISOString() },
        });
        yield { kind: 'status-update', status: { state: 'TASK_STATE_CANCELED' as TaskState } };
        return;
      }

      this.options.logger.info('Task execution attempt', {
        taskId: task.id,
        pluginId,
        attempt,
      });

      try {
        const ctx = {
          logger: this.options.logger,
          abortSignal: opts.abortSignal,
          taskId: task.id,
          contextId: opts.contextId,
        };

        for await (const chunk of plugin.execute(message, ctx)) {
          if (firstYield) {
            firstYield = false;
            await this.taskStore.update(task.id, {
              status: { state: 'TASK_STATE_WORKING' as TaskState, timestamp: new Date().toISOString() },
            });
            yield { kind: 'status-update', status: { state: 'TASK_STATE_WORKING' as TaskState } };
          }
          yield chunk;
          await this.taskStore.appendStreamChunk(task.id, chunk);
        }

        await this.taskStore.update(task.id, {
          status: { state: 'TASK_STATE_COMPLETED' as TaskState, timestamp: new Date().toISOString() },
        });
        yield { kind: 'status-update', status: { state: 'TASK_STATE_COMPLETED' as TaskState } };
        return;
      } catch (err) {
        if (!firstYield) {
          lastError = err;
          break;
        }
        if (err instanceof NonRetriableError) {
          lastError = err;
          break;
        }
        lastError = err;

        if (attempt < this.options.maxAttempts) {
          const backoffMs = this.calculateBackoff(attempt);
          this.options.logger.info('Backing off before retry', {
            taskId: task.id,
            pluginId,
            attempt,
            backoffMs,
          });
          await this.sleep(backoffMs);
        }
      }
    }

    const status: TaskStatus = {
      state: 'TASK_STATE_FAILED' as TaskState,
      message: this.serializeError(lastError),
      timestamp: new Date().toISOString(),
    };
    await this.taskStore.update(task.id, { status });
    yield { kind: 'status-update', status };
    this.options.logger.error('Task failed after all attempts', {
      taskId: task.id,
      pluginId,
      error: lastError,
    });
  }

  private calculateBackoff(attempt: number): number {
    const base = this.options.initialBackoffMs * Math.pow(this.options.backoffMultiplier, attempt - 1);
    const jitter = base * this.options.jitterRatio * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private serializeError(err: unknown): string {
    if (err instanceof Error) {
      return `${err.name}: ${err.message}`;
    }
    return String(err);
  }
}
