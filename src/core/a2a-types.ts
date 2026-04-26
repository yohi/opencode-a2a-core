import { z } from "zod";

export const A2A_PROTOCOL_VERSION = "1.0.0" as const;

// ---- Parts ----
export const TextPartSchema = z.object({
  kind: z.literal("text"),
  text: z.string(),
});

export const FilePartSchema = z.object({
  kind: z.literal("file"),
  file: z
    .object({
      name: z.string().optional(),
      mimeType: z.string().optional(),
      bytes: z.string().base64().optional(), // base64 validation
      uri: z.string().url().optional(),
    })
    .refine((f) => f.bytes != null || f.uri != null, {
      message: "FilePart requires either bytes or uri",
    }),
});

export const DataPartSchema = z.object({
  kind: z.literal("data"),
  data: z.record(z.string(), z.unknown()),
});

export const PartSchema = z.discriminatedUnion("kind", [
  TextPartSchema,
  FilePartSchema,
  DataPartSchema,
]);
export type Part = z.infer<typeof PartSchema>;

// ---- Message ----
export const MessageSchema = z.lazy(() =>
  z.object({
    role: z.enum(["ROLE_USER", "ROLE_AGENT"]),
    parts: z.array(PartSchema).min(1),
    messageId: z.string().optional(),
    taskId: z.string().optional(),
    contextId: z.string().optional(),
  }),
);
export type Message = z.infer<typeof MessageSchema>;

// ---- Task state/status ----
export const TaskStateSchema = z.enum([
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_UNKNOWN",
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TaskStatusSchema = z.object({
  state: TaskStateSchema,
  timestamp: z.string().datetime().optional(),
  message: MessageSchema.optional(),
});
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// ---- Artifact ----
export const ArtifactSchema = z.object({
  artifactId: z.string(),
  parts: z.array(PartSchema).min(1),
  name: z.string().optional(),
  description: z.string().optional(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

// ---- Task ----
export const TaskSchema = z.object({
  id: z.string(),
  contextId: z.string().optional(),
  status: TaskStatusSchema,
  artifacts: z.array(ArtifactSchema).optional(),
  history: z.array(MessageSchema).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

// ---- Stream response (discriminated union) ----
export const StreamResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), task: TaskSchema }),
  z.object({ kind: z.literal("message"), message: MessageSchema }),
  z.object({ kind: z.literal("status-update"), status: TaskStatusSchema }),
  z.object({ kind: z.literal("artifact-update"), artifact: ArtifactSchema }),
]);
export type StreamResponse = z.infer<typeof StreamResponseSchema>;
