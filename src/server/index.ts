import { Hono } from 'hono';
import type { A2APluginInterface } from '../core/plugin-interface.js';
import type { TaskStore } from '../core/task-store.js';
import type { Logger } from '../core/logger.js';
import type { TaskRunnerOptions } from '../core/task-runner.js';
import { InMemoryTaskStore } from '../core/task-store.js';
import { PluginRegistry } from '../core/registry.js';
import { TaskRunner } from '../core/task-runner.js';
import { createLogger } from '../core/logger.js';
import { bearerAuth } from './middleware/auth.js';
import { createRpcHandler } from './rpc/handler.js';

export interface CreateA2AServerOptions {
  plugin: A2APluginInterface;
  taskStore?: TaskStore;
  logger?: Logger;
  auth?: { token: string };
  allowUnauthenticated?: boolean;
  baseUrl?: string;
  /** Trust X-Forwarded-* headers for baseUrl resolution. Default: false. */
  trustProxy?: boolean;
  taskRunnerOptions?: Partial<TaskRunnerOptions>;
}

const DEFAULT_RUNNER_OPTS: Omit<TaskRunnerOptions, 'logger'> = {
  maxAttempts: 3,
  initialBackoffMs: 100,
  maxBackoffMs: 10_000,
  backoffMultiplier: 2,
  jitterRatio: 0.1,
};

export function createA2AServer(options: CreateA2AServerOptions): Hono {
  const logger = options.logger ?? createLogger();

  // Fail-safe: require explicit auth config
  if (!options.auth && !options.allowUnauthenticated) {
    throw new Error(
      'Auth configuration required. Set auth.token or explicitly set allowUnauthenticated: true for development.'
    );
  }

  // Validate token is not empty/whitespace-only
  if (options.auth && options.auth.token.trim().length === 0) {
    throw new Error('Auth token must not be empty or whitespace-only.');
  }

  if (!options.auth && options.allowUnauthenticated) {
    logger.warn('Server running without authentication. Do not use in production.');
  }

  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const registry = new PluginRegistry();
  registry.register(options.plugin);

  const runnerOpts: TaskRunnerOptions = {
    ...DEFAULT_RUNNER_OPTS,
    ...options.taskRunnerOptions,
    logger,
  };
  const taskRunner = new TaskRunner(registry, taskStore, runnerOpts);

  const app = new Hono();

  // AgentCard endpoint (no auth required)
  app.get('/.well-known/agent.json', (c) => {
    const meta = options.plugin.metadata();
    const url = resolveBaseUrl(c, options.baseUrl, options.trustProxy, logger);
    return c.json({
      name: options.plugin.name,
      url,
      version: options.plugin.version,
      capabilities: { streaming: meta.capabilities?.streaming ?? true },
      skills: meta.skills,
    });
  });

  // Auth middleware for RPC endpoints
  if (options.auth) {
    app.post('/*', bearerAuth(options.auth.token));
  }

  // RPC handler
  const deps = {
    taskStore,
    registry,
    taskRunner,
    pluginId: options.plugin.id,
    activeAbortControllers: new Map<string, AbortController>(),
    logger,
  };
  app.post('/', createRpcHandler(deps));

  return app;
}

function resolveBaseUrl(
  c: { req: { url: string; header: (name: string) => string | undefined } },
  baseUrl?: string,
  trustProxy?: boolean,
  logger?: Logger
): string {
  if (baseUrl) return baseUrl;

  if (trustProxy) {
    const proto = c.req.header('x-forwarded-proto')?.toLowerCase();
    const host = c.req.header('x-forwarded-host');

    if (proto && host) {
      const isValidProto = proto === 'http' || proto === 'https';
      const firstHost = host.split(',')[0].trim();
      // Refined host validation to prevent path components or userinfo injection
      // Explicitly reject /, @, ?, # and whitespace/angle brackets
      const isValidHost = firstHost.length > 0 && !/[\s<>/@?#]/.test(firstHost);

      if (isValidProto && isValidHost) {
        return `${proto}://${firstHost}`;
      }

      logger?.warn(`Rejected invalid X-Forwarded headers: proto=${proto}, host=${host}`);
    }
  }

  return new URL(c.req.url).origin;
}
