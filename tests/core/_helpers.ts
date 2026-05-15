import { z } from 'zod';
import type { A2APluginInterface } from '../../src/core/plugin-interface.js';
import type { Message, StreamResponse } from '../../src/core/a2a-types.js';
import { ConsoleLogger, type Logger } from '../../src/core/logger.js';

export function silentLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

export function mkMessage(): Message {
  return { role: 'ROLE_USER', parts: [{ kind: 'text', text: 'hi' }] };
}

export function mkPlugin(
  id: string,
  executeFn: (
    msg: Message,
    ctx: { abortSignal: AbortSignal; logger: Logger; taskId: string; contextId?: string }
  ) => AsyncIterable<StreamResponse>
): A2APluginInterface {
  return {
    id,
    name: id,
    version: '1.0.0',
    configSchema: z.object({}).passthrough(),
    async initialize() {},
    async dispose() {},
    execute: executeFn,
    metadata: () => ({ skills: [{ id, name: id, description: '' }] }),
  };
}

export async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

export { ConsoleLogger };
