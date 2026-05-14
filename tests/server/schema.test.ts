import { describe, it, expect } from 'vitest';
import {
  JsonRpcRequestSchema,
  MessageSendParamsSchema,
  MessageStreamParamsSchema,
  TasksGetParamsSchema,
  TasksCancelParamsSchema,
  JSON_RPC_ERRORS,
} from '../../src/server/rpc/schema.js';

describe('JsonRpcRequestSchema', () => {
  it('accepts valid request with id', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid request with string id', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'abc-123',
      method: 'message/send',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid request with null id', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: null,
      method: 'message/send',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid request with array params', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: [1, 2, 3],
    });
    expect(result.success).toBe(true);
  });

  it('rejects primitive params', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects notification (no id)', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'message/send',
    });
    expect(result.success).toBe(false);
  });

  it('rejects wrong jsonrpc version', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '1.0',
      id: 1,
      method: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing method', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('MessageSendParamsSchema', () => {
  it('accepts valid params', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: { role: 'ROLE_USER', parts: [{ kind: 'text', text: 'hello' }] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts params with contextId', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: { role: 'ROLE_USER', parts: [{ kind: 'text', text: 'hello' }] },
      contextId: 'ctx-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing message', () => {
    const result = MessageSendParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('MessageStreamParamsSchema', () => {
  it('accepts valid params', () => {
    const result = MessageStreamParamsSchema.safeParse({
      message: { role: 'ROLE_USER', parts: [{ kind: 'text', text: 'hello' }] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid payload', () => {
    const result = MessageStreamParamsSchema.safeParse({
      invalid: 'field',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing message', () => {
    const result = MessageStreamParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TasksGetParamsSchema', () => {
  it('accepts valid params', () => {
    const result = TasksGetParamsSchema.safeParse({ taskId: 'task-1' });
    expect(result.success).toBe(true);
  });

  it('rejects missing taskId', () => {
    const result = TasksGetParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TasksCancelParamsSchema', () => {
  it('accepts valid params', () => {
    const result = TasksCancelParamsSchema.safeParse({ taskId: 'task-1' });
    expect(result.success).toBe(true);
  });

  it('rejects missing taskId', () => {
    const result = TasksCancelParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('JSON_RPC_ERRORS', () => {
  it('has all required error codes', () => {
    expect(JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700);
    expect(JSON_RPC_ERRORS.INVALID_REQUEST).toBe(-32600);
    expect(JSON_RPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
    expect(JSON_RPC_ERRORS.INVALID_PARAMS).toBe(-32602);
    expect(JSON_RPC_ERRORS.INTERNAL_ERROR).toBe(-32603);
    expect(JSON_RPC_ERRORS.TASK_NOT_FOUND).toBe(-32001);
    expect(JSON_RPC_ERRORS.TASK_CANCELED).toBe(-32002);
  });
});