import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineA2APlugin } from '../../src/core/define-plugin.js';
import type {
  A2APluginInterface,
  A2APluginContext,
} from '../../src/core/plugin-interface.js';
import type { Message, StreamResponse } from '../../src/core/a2a-types.js';
import { createLogger } from '../../src/core/logger.js';

describe('defineA2APlugin', () => {
  it('returns the input object unchanged and preserves typing', () => {
    const schema = z.object({ foo: z.string() });
    const plugin: A2APluginInterface<z.infer<typeof schema>> = {
      id: 'test',
      version: '0.0.1',
      configSchema: schema,
      async initialize() {},
      async dispose() {},
      async *execute() {},
      metadata: () => ({
        skills: [{ id: 'test', name: 'Test', description: 't' }],
      }),
    };
    const defined = defineA2APlugin(plugin);
    expect(defined).toBe(plugin);
    expect(defined.id).toBe('test');
  });

  it('works with minimal plugin definition (optional config/hooks)', () => {
    const plugin: A2APluginInterface = {
      id: 'minimal',
      version: '1.0.0',
      async *execute() {
        yield {
          kind: 'task',
          task: {
            id: '123',
            status: { state: 'TASK_STATE_COMPLETED' },
          },
        };
      },
      metadata: () => ({ skills: [] }),
    };
    const defined = defineA2APlugin(plugin);
    expect(defined.configSchema).toBeUndefined();
    expect(defined.initialize).toBeUndefined();
    expect(defined.dispose).toBeUndefined();
  });

  it('verifies execute behavior as AsyncIterable', async () => {
    const mockResponse: StreamResponse = {
      kind: 'message',
      message: {
        role: 'ROLE_AGENT',
        parts: [{ kind: 'text', text: 'hello' }],
      },
    };
    const plugin: A2APluginInterface = {
      id: 'stream-test',
      version: '1.0.0',
      async *execute() {
        yield mockResponse;
      },
      metadata: () => ({ skills: [] }),
    };

    const dummyContext: A2APluginContext = {
      logger: createLogger(),
      abortSignal: new AbortController().signal,
      taskId: 'test-task',
    };

    const dummyMessage: Message = {
      role: 'ROLE_USER',
      parts: [{ kind: 'text', text: 'ping' }],
    };

    const results: StreamResponse[] = [];
    for await (const res of plugin.execute(dummyMessage, dummyContext)) {
      results.push(res);
    }
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(mockResponse);
  });
});
