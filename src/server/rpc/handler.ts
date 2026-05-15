import type { Handler } from 'hono';
import type { TaskStore } from '../../core/task-store.js';
import type { PluginRegistry } from '../../core/registry.js';
import type { TaskRunner } from '../../core/task-runner.js';
import type { Logger } from '../../core/logger.js';
import { streamSSE } from 'hono/streaming';
import {
  JsonRpcRequestSchema,
  MessageSendParamsSchema,
  MessageStreamParamsSchema,
  TasksGetParamsSchema,
  TasksCancelParamsSchema,
  JSON_RPC_ERRORS,
} from './schema.js';

export interface ServerDependencies {
  taskStore: TaskStore;
  registry: PluginRegistry;
  taskRunner: TaskRunner;
  pluginId: string;
  activeAbortControllers: Map<string, AbortController>;
  logger: Logger;
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

function rpcResult(id: string | number, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

const TERMINAL_STATES = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
]);

export function createRpcHandler(deps: ServerDependencies): Handler {
  return async (c) => {
    // 1. JSON parse
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(rpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error'));
    }

    // 2. JSON-RPC structure validation
    const parsed = JsonRpcRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        rpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid Request')
      );
    }
    const { method, params, id } = parsed.data;

    // 4. Method dispatch
    try {
      switch (method) {
        case 'message/send':
          return await handleMessageSend(c, deps, id, params);
        case 'message/stream':
          return await handleMessageStream(c, deps, id, params);
        case 'tasks/get':
          return await handleTasksGet(c, deps, id, params);
        case 'tasks/cancel':
          return await handleTasksCancel(c, deps, id, params);
        default:
          return c.json(
            rpcError(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`)
          );
      }
    } catch (err) {
      deps.logger.error('Internal server error', { error: err });
      return c.json(
        rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal server error')
      );
    }
  };
}

async function handleMessageSend(
  c: { req: { raw: Request }; json: (data: unknown, status?: number) => Response },
  deps: ServerDependencies,
  id: string | number,
  params: unknown
) {
  const parsed = MessageSendParamsSchema.safeParse(params);
  if (!parsed.success) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params'));
  }

  const abortController = new AbortController();
  let taskId: string | undefined;

  const onAbort = () => abortController.abort();
  c.req.raw.signal.addEventListener('abort', onAbort);
  if (c.req.raw.signal.aborted) abortController.abort();

  try {
    const iter = deps.taskRunner.run(deps.pluginId, parsed.data.message, {
      abortSignal: abortController.signal,
      contextId: parsed.data.contextId,
    });

    for await (const chunk of iter) {
      if (chunk.kind === 'task' && !taskId) {
        taskId = chunk.task.id;
        deps.activeAbortControllers.set(taskId, abortController);
      }
    }

    if (!taskId) {
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'No task was created'));
    }

    const task = await deps.taskStore.get(taskId);
    if (!task) {
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error: Task disappeared'));
    }
    return c.json(rpcResult(id, task));
  } catch (err) {
    deps.logger.error('handleMessageSend failed', { taskId, id, err });
    if (!taskId) {
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error'));
    }
    const task = await deps.taskStore.get(taskId);
    if (!task) {
      return c.json(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error: Task not found after failure'));
    }
    // Task exists, return it even if failed
    return c.json(rpcResult(id, task));
  } finally {
    if (taskId) deps.activeAbortControllers.delete(taskId);
    c.req.raw.signal.removeEventListener('abort', onAbort);
  }
}

async function handleMessageStream(
  c: Parameters<Handler>[0],
  deps: ServerDependencies,
  id: string | number,
  params: unknown
) {
  const parsed = MessageStreamParamsSchema.safeParse(params);
  if (!parsed.success) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params'));
  }

  const abortController = new AbortController();
  let taskId: string | undefined;

  const onAbort = () => abortController.abort();
  c.req.raw.signal.addEventListener('abort', onAbort);
  if (c.req.raw.signal.aborted) abortController.abort();

  try {
    return streamSSE(c, async (stream) => {
    try {
      const iter = deps.taskRunner.run(deps.pluginId, parsed.data.message, {
        abortSignal: abortController.signal,
        contextId: parsed.data.contextId,
      });

      for await (const chunk of iter) {
        if (chunk.kind === 'task' && !taskId) {
          taskId = chunk.task.id;
          deps.activeAbortControllers.set(taskId, abortController);
        }
        await stream.writeSSE({ event: chunk.kind, data: JSON.stringify(chunk) });
      }
    } catch (err) {
      deps.logger.error('handleMessageStream failed', { taskId, id, err });
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify(rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error')),
      });
    } finally {
      if (taskId) deps.activeAbortControllers.delete(taskId);
      c.req.raw.signal.removeEventListener('abort', onAbort);
    }
  });
  } catch (err) {
    c.req.raw.signal.removeEventListener('abort', onAbort);
    throw err;
  }
}

async function handleTasksGet(
  c: { json: (data: unknown, status?: number) => Response },
  deps: ServerDependencies,
  id: string | number,
  params: unknown
) {
  const parsed = TasksGetParamsSchema.safeParse(params);
  if (!parsed.success) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params'));
  }

  const task = await deps.taskStore.get(parsed.data.taskId);
  if (!task) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.TASK_NOT_FOUND, 'Task not found'));
  }
  return c.json(rpcResult(id, task));
}

async function handleTasksCancel(
  c: { req: { raw: Request }; json: (data: unknown, status?: number) => Response },
  deps: ServerDependencies,
  id: string | number,
  params: unknown
) {
  const parsed = TasksCancelParamsSchema.safeParse(params);
  if (!parsed.success) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params'));
  }

  const task = await deps.taskStore.get(parsed.data.taskId);
  if (!task) {
    return c.json(rpcError(id, JSON_RPC_ERRORS.TASK_NOT_FOUND, 'Task not found'));
  }

  const isTerminal = TERMINAL_STATES.has(task.status.state);
  if (isTerminal) {
    return c.json(
      rpcError(
        id,
        JSON_RPC_ERRORS.TASK_NOT_CANCELABLE,
        `Task is already in terminal state (${task.status.state}) and cannot be canceled`
      )
    );
  }

  const ac = deps.activeAbortControllers.get(parsed.data.taskId);
  if (!ac) {
    // Re-check task status to handle race where it might have finished just now
    const latestTask = await deps.taskStore.get(parsed.data.taskId);
    if (latestTask && TERMINAL_STATES.has(latestTask.status.state)) {
      return c.json(
        rpcError(
          id,
          JSON_RPC_ERRORS.TASK_NOT_CANCELABLE,
          `Task is already in terminal state (${latestTask.status.state}) and cannot be canceled`
        )
      );
    }
    return c.json(
      rpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Abort controller missing for non-terminal task')
    );
  }

  ac.abort();

  // Poll for terminal state
  const maxWait = 5000;
  const interval = 100;
  const start = Date.now();
  let currentTask = task;

  while (Date.now() - start < maxWait) {
    if (c.req.raw.signal.aborted) {
      // Client disconnected, no use returning a response
      return new Response(null, { status: 499 });
    }
    const current = await deps.taskStore.get(parsed.data.taskId);
    if (current) {
      currentTask = current;
      if (TERMINAL_STATES.has(current.status.state)) {
        return c.json(rpcResult(id, current));
      }
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  // Timeout reached, return the latest state we have
  return c.json(rpcResult(id, currentTask));
}
