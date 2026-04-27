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
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      // Will be extended in Task 18 to emit FAILED status update
      throw new NonRetriableError(`plugin not found: ${pluginId}`);
    }

    const task = await this.taskStore.create({
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    });
    yield { kind: "task", task };

    const ctx: A2APluginContext = {
      logger: this.options.logger,
      abortSignal: opts.abortSignal,
      taskId: task.id,
      ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
    };

    let lastError: unknown;
    let firstYielded = false;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        for await (const chunk of plugin.execute(message, ctx)) {
          if (!firstYielded) {
            firstYielded = true;
            const workingStatus: TaskStatus = {
              state: "TASK_STATE_WORKING",
              timestamp: new Date().toISOString(),
            };
            await this.taskStore.updateStatus(task.id, workingStatus);
            yield { kind: "status-update", status: workingStatus };
          }
          yield chunk;
          await this.taskStore.appendStreamChunk(task.id, chunk);
        }
        
        const currentTask = await this.taskStore.get(task.id);
        if (currentTask?.status.state === "TASK_STATE_WORKING") {
          const completedStatus: TaskStatus = {
            state: "TASK_STATE_COMPLETED",
            timestamp: new Date().toISOString(),
          };
          await this.taskStore.updateStatus(task.id, completedStatus);
          yield { kind: "status-update", status: completedStatus };
        }
        return;
      } catch (err) {
        lastError = err;
        this.options.logger.warn("plugin execute failed", {
          taskId: task.id,
          pluginId,
          attempt,
          error: serializeError(err).message,
        });
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

    const failed: TaskStatus = {
      state: "TASK_STATE_FAILED",
      timestamp: new Date().toISOString(),
      message: serializeError(lastError).message,
    };
    await this.taskStore.updateStatus(task.id, failed);
    yield { kind: "status-update", status: failed };
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
