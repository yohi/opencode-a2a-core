import { createHttpServer } from './http-server.js';
import { PluginRegistry } from '../core/registry.js';
import { InMemoryTaskStore } from '../core/task-store.js';
import { TaskRunner } from '../core/task-runner.js';
import { createLogger } from '../core/logger.js';
import { GeminiCliPlugin } from '../plugins/gemini-cli-plugin.js';
import { serve } from '@hono/node-server';

async function main(): Promise<void> {
  const logger = createLogger({ level: 'info' });
  const registry = new PluginRegistry();
  const taskStore = new InMemoryTaskStore();

  // Register plugins
  registry.register(new GeminiCliPlugin());

  // Initialize plugins
  await registry.initializeAll({
    'gemini-cli': {
      cliPath: process.env.GEMINI_CLI_PATH ?? 'gemini',
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-pro',
    },
  });

  const taskRunner = new TaskRunner(registry, taskStore, {
    maxAttempts: 3,
    initialBackoffMs: 500,
    backoffMultiplier: 2,
    jitterRatio: 0.2,
    logger,
  });

  const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';
  const authTokens = process.env.A2A_BEARER_TOKEN ? [process.env.A2A_BEARER_TOKEN] : ['dev-token'];

  const app = createHttpServer({
    registry,
    taskRunner,
    taskStore,
    publicUrl,
    authTokens,
    logger,
  });

  const port = parseInt(process.env.PORT ?? '3000', 10);

  logger.info('Starting A2A server', { port, publicUrl });

  // Use Hono Node.js server
  serve({
    fetch: app.fetch,
    port,
  }, (info: { port: number }) => {
    logger.info('A2A server started', { url: `http://localhost:${info.port}` });
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await registry.disposeAll();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    await registry.disposeAll();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
