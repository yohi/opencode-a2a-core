import type { Message, StreamResponse, TaskStatus } from "./a2a-types.js";
import type { A2APluginContext } from "./plugin-interface.js";
import type { PluginRegistry } from "./registry.js";
import type { TaskStore } from "./task-store.js";
import type { Logger } from "./logger.js";
import { NonRetriableError } from "./errors.js";

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

    const workingStatus: TaskStatus = {
      state: "TASK_STATE_WORKING",
      timestamp: new Date().toISOString(),
    };
    await this.taskStore.updateStatus(task.id, workingStatus);
    yield { kind: "status-update", status: workingStatus };

    try {
      for await (const chunk of plugin.execute(message, ctx)) {
        await this.taskStore.appendStreamChunk(task.id, chunk);
        yield chunk;
      }
    } catch (e) {
      const failedStatus: TaskStatus = {
        state: "TASK_STATE_FAILED",
        timestamp: new Date().toISOString(),
      };
      await this.taskStore.updateStatus(task.id, failedStatus);
      yield { kind: "status-update", status: failedStatus };
      throw e;
    }

    const completedStatus: TaskStatus = {
      state: "TASK_STATE_COMPLETED",
      timestamp: new Date().toISOString(),
    };
    await this.taskStore.updateStatus(task.id, completedStatus);
    yield { kind: "status-update", status: completedStatus };
  }
}
