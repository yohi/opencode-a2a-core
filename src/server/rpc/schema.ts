import { z } from 'zod';
import { MessageSchema } from '../../core/a2a-types.js';

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const MessageParamsSchema = z.object({
  message: MessageSchema,
  contextId: z.string().optional(),
});

export const MessageSendParamsSchema = MessageParamsSchema;
export type MessageSendParams = z.infer<typeof MessageParamsSchema>;

export const MessageStreamParamsSchema = MessageParamsSchema;
export type MessageStreamParams = z.infer<typeof MessageParamsSchema>;

export const TasksGetParamsSchema = z.object({
  taskId: z.string(),
});
export type TasksGetParams = z.infer<typeof TasksGetParamsSchema>;

export const TasksCancelParamsSchema = z.object({
  taskId: z.string(),
});
export type TasksCancelParams = z.infer<typeof TasksCancelParamsSchema>;

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_CANCELED: -32002,
} as const;