import type { Message, StreamResponse, TaskStatus } from "./a2a-types.js";
import type { A2APluginContext } from "./plugin-interface.js";
import type { PluginRegistry } from "./registry.js";
import type { TaskStore } from "./task-store.js";
import type { Logger } from "./logger.js";
import { NonRetriableError, serializeError } from "./errors.js";
import { computeBackoffMs } from "./helpers/exponential-backoff.js";

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
    const task = await this.taskStore.create({
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    });
    yield { kind: "task", task };

    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      yield* this.emitFailed(task.id, new NonRetriableError(`plugin not found: ${pluginId}`));
      return;
    }

    const ctx: A2APluginContext = {
      logger: this.options.logger,
      abortSignal: opts.abortSignal,
      taskId: task.id,
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    };

    let lastError: unknown;
    let firstYielded = false;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      if (opts.abortSignal.aborted) {
        yield* this.emitTerminal(task.id, "TASK_STATE_CANCELED");
        return;
      }
      try {
        for await (const chunk of plugin.execute(message, ctx)) {
          if (!firstYielded) {
            firstYielded = true;
            yield* this.emitWorking(task.id);
          }
          yield chunk;
          await this.taskStore.appendStreamChunk(task.id, chunk);
        }
        yield* this.emitTerminal(task.id, "TASK_STATE_COMPLETED");
        return;
      } catch (err) {
        if (opts.abortSignal.aborted) {
          yield* this.emitTerminal(task.id, "TASK_STATE_CANCELED");
          return;
        }
        lastError = err;
        this.options.logger.warn("plugin execute failed", {
          taskId: task.id,
          pluginId,
          attempt,
          error: serializeError(err).message,
        });
        if (err instanceof NonRetriableError) break;
        if (firstYielded) break;
        if (attempt < this.options.maxAttempts) {
          await this.sleep(
            computeBackoffMs(attempt, {
              initialMs: this.options.initialBackoffMs,
              multiplier: this.options.backoffMultiplier,
              jitterRatio: this.options.jitterRatio,
            }),
          );
        }
      }
    }

    yield* this.emitFailed(task.id, lastError);
  }

  private async *emitWorking(taskId: string): AsyncIterable<StreamResponse> {
    const status: TaskStatus = {
      state: "TASK_STATE_WORKING",
      timestamp: new Date().toISOString(),
    };
    await this.taskStore.update(taskId, { status });
    await this.taskStore.appendHistoryEntry(taskId, status);
    yield { kind: "status-update", status };
  }

  private async *emitTerminal(
    taskId: string,
    state: "TASK_STATE_COMPLETED" | "TASK_STATE_CANCELED",
  ): AsyncIterable<StreamResponse> {
    const status: TaskStatus = { state, timestamp: new Date().toISOString() };
    await this.taskStore.update(taskId, { status });
    await this.taskStore.appendHistoryEntry(taskId, status);
    yield { kind: "status-update", status };
  }

  private async *emitFailed(taskId: string, err: unknown): AsyncIterable<StreamResponse> {
    const status: TaskStatus = {
      state: "TASK_STATE_FAILED",
      timestamp: new Date().toISOString(),
      message: serializeError(err).message,
    };
    await this.taskStore.update(taskId, { status });
    await this.taskStore.appendHistoryEntry(taskId, status);
    yield { kind: "status-update", status };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
