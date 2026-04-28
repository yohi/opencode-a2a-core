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
    let workingStatusEmitted = false;
    let chunksYielded = false;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      if (opts.abortSignal.aborted) {
        yield* this.emitTerminal(task.id, "TASK_STATE_CANCELED");
        return;
      }
      try {
        if (!workingStatusEmitted) {
          yield* this.emitWorking(task.id);
          workingStatusEmitted = true;
        }

        for await (const chunk of plugin.execute(message, ctx)) {
          chunksYielded = true;
          await this.taskStore.appendStreamChunk(task.id, chunk);
          yield chunk;
        }

        const currentTask = await this.taskStore.get(task.id);
        if (currentTask?.status.state === "TASK_STATE_WORKING") {
          yield* this.emitTerminal(task.id, "TASK_STATE_COMPLETED");
        }
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

        // If we already started yielding chunks, don't retry as it might result in duplicate partial data
        if (chunksYielded) break;

        if (err instanceof NonRetriableError) break;

        if (attempt < this.options.maxAttempts) {
          try {
            await this.sleep(
              computeBackoffMs(attempt, {
                initialMs: this.options.initialBackoffMs,
                multiplier: this.options.backoffMultiplier,
                jitterRatio: this.options.jitterRatio,
              }),
              opts.abortSignal,
            );
          } catch (sleepErr) {
            lastError = sleepErr;
            // Break loop on sleep failure (e.g. AbortSignal)
            break;
          }
        }
      }
    }

    if (opts.abortSignal.aborted) {
      yield* this.emitTerminal(task.id, "TASK_STATE_CANCELED");
      return;
    }

    yield* this.emitFailed(task.id, lastError);
    throw lastError;
  }

  private async *emitWorking(taskId: string): AsyncIterable<StreamResponse> {
    const status: TaskStatus = {
      state: "TASK_STATE_WORKING",
      timestamp: new Date().toISOString(),
    };
    await this.taskStore.updateStatus(taskId, status);
    yield { kind: "status-update", status };
  }

  private async *emitTerminal(
    taskId: string,
    state: "TASK_STATE_COMPLETED" | "TASK_STATE_CANCELED",
  ): AsyncIterable<StreamResponse> {
    const status: TaskStatus = { state, timestamp: new Date().toISOString() };
    await this.taskStore.updateStatus(taskId, status);
    yield { kind: "status-update", status };
  }

  private async *emitFailed(taskId: string, err: unknown): AsyncIterable<StreamResponse> {
    const status: TaskStatus = {
      state: "TASK_STATE_FAILED",
      timestamp: new Date().toISOString(),
      message: serializeError(err).message,
    };
    await this.taskStore.updateStatus(taskId, status);
    yield { kind: "status-update", status };
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(signal.reason);
      }
      const timeout = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timeout);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
