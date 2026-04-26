import { Hono } from 'hono';
import type { PluginRegistry } from '../core/registry.js';
import type { TaskRunner } from '../core/task-runner.js';
import type { TaskStore } from '../core/task-store.js';
import { JSONRPCRouter, JSONRPCError } from './jsonrpc-router.js';
import { SSEWriter } from './sse-writer.js';
import { createAgentCard } from './agent-card.js';
import { BearerAuth } from './auth.js';
import { MessageSchema, type Message, type Task } from '../core/a2a-types.js';
import { TaskState } from '../core/a2a-types.js';
import type { Logger } from '../core/logger.js';
import { z } from 'zod';

export interface HttpServerOptions {
  registry: PluginRegistry;
  taskRunner: TaskRunner;
  taskStore: TaskStore;
  publicUrl: string;
  authTokens: string[];
  logger: Logger;
}

const MessageSendParamsSchema = z.object({
  message: MessageSchema,
  pluginId: z.string(),
});

const TaskGetParamsSchema = z.object({
  id: z.string(),
});

const TaskCancelParamsSchema = z.object({
  id: z.string(),
});

export function createHttpServer(options: HttpServerOptions): Hono {
  const app = new Hono();
  const auth = new BearerAuth({ tokens: options.authTokens });
  const abortControllers = new Map<string, AbortController>();

  // Agent Card endpoint (unauthenticated)
  app.get('/.well-known/agent.json', (c) => {
    const card = createAgentCard({
      plugins: options.registry.list(),
      publicUrl: options.publicUrl,
    });
    return c.json(card);
  });

  // Health endpoint (unauthenticated)
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // JSON-RPC endpoint (authenticated)
  app.post('/', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!auth.validate(authHeader)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();

    // Handle streaming
    if (body.method === 'message/stream') {
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const write = (data: string) => controller.enqueue(encoder.encode(data));
          const sse = new SSEWriter(write);

          try {
            const params = MessageSendParamsSchema.parse(body.params);
            const abortController = new AbortController();

            for await (const chunk of options.taskRunner.run(params.pluginId, params.message, {
              abortSignal: abortController.signal,
            })) {
              sse.writeEvent(chunk.kind, chunk);
            }
          } catch (err) {
            sse.writeError({
              code: -32603,
              message: err instanceof Error ? err.message : 'Internal error',
            });
          } finally {
            sse.done();
            controller.close();
          }
        },
      });

      return c.body(stream);
    }

    // Handle standard JSON-RPC
    const router = new JSONRPCRouter();

    router.register('message/send', async (params) => {
      const parsed = MessageSendParamsSchema.parse(params);
      const abortController = new AbortController();
      const chunks: unknown[] = [];

      for await (const chunk of options.taskRunner.run(parsed.pluginId, parsed.message, {
        abortSignal: abortController.signal,
      })) {
        chunks.push(chunk);
      }

      // Return final task
      const taskChunk = chunks.find((c) => (c as { kind: string }).kind === 'task') as { task: Task } | undefined;
      return taskChunk?.task ?? null;
    });

    router.register('tasks/get', async (params) => {
      const parsed = TaskGetParamsSchema.parse(params);
      const task = await options.taskStore.get(parsed.id);
      if (!task) {
        throw new JSONRPCError(-32602, 'Task not found');
      }
      return task;
    });

    router.register('tasks/cancel', async (params) => {
      const parsed = TaskCancelParamsSchema.parse(params);
      const abortController = abortControllers.get(parsed.id);
      if (abortController) {
        abortController.abort();
        abortControllers.delete(parsed.id);
      }
      const task = await options.taskStore.get(parsed.id);
      return task ?? { id: parsed.id, status: { state: 'TASK_STATE_CANCELED' as import('../core/a2a-types.js').TaskState } };
    });

    const response = await router.route(body);
    return c.json(response);
  });

  return app;
}
