import { z } from 'zod';
import type { A2APluginInterface } from '../../src/core/plugin-interface.js';
import type { Message, StreamResponse } from '../../src/core/a2a-types.js';
import type { Logger } from '../../src/core/logger.js';

export function silentLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

export function mkMessage(text = 'hello'): Message {
  return { role: 'ROLE_USER', parts: [{ kind: 'text', text }] };
}

export function createTestPlugin(
  id: string,
  executeFn: (
    msg: Message,
    ctx: { abortSignal: AbortSignal }
  ) => AsyncIterable<StreamResponse>
): A2APluginInterface {
  return {
    id,
    version: '1.0.0',
    configSchema: z.object({}).passthrough(),
    async initialize() {},
    async dispose() {},
    execute: executeFn,
    metadata: () => ({
      skills: [{ id, name: id, description: `Test plugin ${id}` }],
    }),
  };
}

export function rpcRequest(
  method: string,
  params?: unknown,
  id?: string | number
): Request {
  const body: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (id !== undefined) body.id = id;
  if (params !== undefined) body.params = params;
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
