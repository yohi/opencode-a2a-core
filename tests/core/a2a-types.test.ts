import { describe, it, expect } from "vitest";
import {
  A2A_PROTOCOL_VERSION,
  PartSchema,
  MessageSchema,
  TaskStateSchema,
  TaskStatusSchema,
  ArtifactSchema,
  TaskSchema,
  StreamResponseSchema,
} from "../../src/core/a2a-types.js";

describe("A2A_PROTOCOL_VERSION", () => {
  it("is 1.0.0", () => {
    expect(A2A_PROTOCOL_VERSION).toBe("1.0.0");
  });
});

describe("PartSchema discriminated union", () => {
  it("accepts TextPart", () => {
    expect(PartSchema.parse({ kind: "text", text: "hi" })).toEqual({
      kind: "text",
      text: "hi",
    });
  });

  it("accepts FilePart with bytes", () => {
    expect(
      PartSchema.parse({ kind: "file", file: { name: "a.txt", bytes: "aGVsbG8=" } }),
    ).toMatchObject({ kind: "file", file: { name: "a.txt" } });
  });

  it("rejects FilePart without bytes or uri", () => {
    expect(() =>
      PartSchema.parse({ kind: "file", file: { name: "a.txt" } }),
    ).toThrow();
  });

  it("accepts DataPart with arbitrary data", () => {
    const data = { foo: "bar", num: 123 };
    expect(PartSchema.parse({ kind: "data", data })).toEqual({
      kind: "data",
      data,
    });
  });

  it("rejects unknown kind", () => {
    expect(() => PartSchema.parse({ kind: "video", src: "x" })).toThrow();
  });
});

describe("MessageSchema", () => {
  it("requires role and parts", () => {
    expect(() => MessageSchema.parse({ role: "ROLE_USER" })).toThrow();
    const m = MessageSchema.parse({
      role: "ROLE_USER",
      parts: [{ kind: "text", text: "hi" }],
    });
    expect(m.role).toBe("ROLE_USER");
  });

  it("rejects empty parts array", () => {
    expect(() =>
      MessageSchema.parse({
        role: "ROLE_USER",
        parts: [],
      }),
    ).toThrow();
  });

  it("rejects invalid roles", () => {
    expect(() =>
      MessageSchema.parse({
        role: "INVALID_ROLE",
        parts: [{ kind: "text", text: "hi" }],
      }),
    ).toThrow();
  });
});

describe("TaskStateSchema", () => {
  it("accepts the defined states", () => {
    for (const s of [
      "TASK_STATE_SUBMITTED",
      "TASK_STATE_WORKING",
      "TASK_STATE_INPUT_REQUIRED",
      "TASK_STATE_COMPLETED",
      "TASK_STATE_FAILED",
      "TASK_STATE_CANCELED",
      "TASK_STATE_UNKNOWN",
    ]) {
      expect(TaskStateSchema.parse(s)).toBe(s);
    }
  });

  it("rejects unknown states", () => {
    expect(() => TaskStateSchema.parse("TASK_STATE_NOT_REAL")).toThrow();
  });
});

describe("TaskStatusSchema / ArtifactSchema / TaskSchema", () => {
  it("TaskStatus with state+message+timestamp parses", () => {
    expect(
      TaskStatusSchema.parse({
        state: "TASK_STATE_FAILED",
        message: {
          role: "ROLE_AGENT",
          parts: [{ kind: "text", text: "boom" }],
        },
        timestamp: "2026-04-24T10:00:00.000Z",
      }),
    ).toMatchObject({ state: "TASK_STATE_FAILED" });
  });

  it("rejects invalid timestamp", () => {
    expect(() =>
      TaskStatusSchema.parse({
        state: "TASK_STATE_WORKING",
        timestamp: "not-a-date",
      }),
    ).toThrow();
  });

  it("Artifact requires artifactId and parts", () => {
    const a = ArtifactSchema.parse({
      artifactId: "a-1",
      parts: [{ kind: "text", text: "ok" }],
    });
    expect(a.artifactId).toBe("a-1");
  });

  it("rejects Artifact with missing fields or empty parts", () => {
    expect(() => ArtifactSchema.parse({ parts: [{ kind: "text", text: "ok" }] })).toThrow();
    expect(() => ArtifactSchema.parse({ artifactId: "a-1" })).toThrow();
    expect(() => ArtifactSchema.parse({ artifactId: "a-1", parts: [] })).toThrow();
  });

  it("Task requires id and status", () => {
    const t = TaskSchema.parse({
      id: "t-1",
      status: { state: "TASK_STATE_SUBMITTED" },
    });
    expect(t.id).toBe("t-1");
  });

  it("rejects Task with missing fields or invalid status", () => {
    expect(() => TaskSchema.parse({ status: { state: "TASK_STATE_SUBMITTED" } })).toThrow();
    expect(() => TaskSchema.parse({ id: "t-1" })).toThrow();
    expect(() => TaskSchema.parse({ id: "t-1", status: { state: "INVALID" } })).toThrow();
  });
});

describe("StreamResponseSchema discriminated union", () => {
  it("accepts kind=task", () => {
    const r = StreamResponseSchema.parse({
      kind: "task",
      task: { id: "t-1", status: { state: "TASK_STATE_SUBMITTED" } },
    });
    expect(r.kind).toBe("task");
  });

  it("accepts kind=status-update", () => {
    expect(
      StreamResponseSchema.parse({
        kind: "status-update",
        status: { state: "TASK_STATE_WORKING" },
      }).kind,
    ).toBe("status-update");
  });

  it("accepts kind=artifact-update", () => {
    expect(
      StreamResponseSchema.parse({
        kind: "artifact-update",
        artifact: { artifactId: "a1", parts: [{ kind: "text", text: "x" }] },
      }).kind,
    ).toBe("artifact-update");
  });

  it("accepts kind=message", () => {
    expect(
      StreamResponseSchema.parse({
        kind: "message",
        message: { role: "ROLE_AGENT", parts: [{ kind: "text", text: "hi" }] },
      }).kind,
    ).toBe("message");
  });

  it("rejects StreamResponse when required payload is missing", () => {
    expect(() => StreamResponseSchema.parse({ kind: "task" })).toThrow();
    expect(() => StreamResponseSchema.parse({ kind: "status-update" })).toThrow();
    expect(() => StreamResponseSchema.parse({ kind: "artifact-update" })).toThrow();
    expect(() => StreamResponseSchema.parse({ kind: "message" })).toThrow();
  });

  it("rejects unknown kind", () => {
    expect(() => StreamResponseSchema.parse({ kind: "oops" })).toThrow();
  });
});
