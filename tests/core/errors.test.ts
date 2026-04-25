import { describe, it, expect } from "vitest";
import {
  A2AError,
  NonRetriableError,
  SubprocessError,
  serializeError,
} from "../../src/core/errors.js";

describe("A2AError hierarchy", () => {
  it("A2AError carries code + message", () => {
    const err = new A2AError("BOOM", "something went wrong");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(A2AError);
    expect(err.code).toBe("BOOM");
    expect(err.message).toBe("something went wrong");
  });

  it("NonRetriableError is an A2AError and signals no retry", () => {
    const err = new NonRetriableError("PluginNotFound");
    expect(err).toBeInstanceOf(A2AError);
    expect(err.code).toBe("NonRetriable");
    expect(err.message).toBe("PluginNotFound");
  });

  it("SubprocessError carries exitCode and stderr", () => {
    const err = new SubprocessError(127, "command not found");
    expect(err).toBeInstanceOf(A2AError);
    expect(err.code).toBe("SubprocessFailed");
    expect(err.exitCode).toBe(127);
    expect(err.stderr).toBe("command not found");
  });
});

describe("serializeError", () => {
  it("serializes A2AError to { code, message }", () => {
    const out = serializeError(new A2AError("X", "y"));
    expect(out).toEqual({ code: "X", message: "y" });
  });

  it("serializes generic Error to { code: 'Unknown', message }", () => {
    const out = serializeError(new Error("oops"));
    expect(out).toEqual({ code: "Unknown", message: "oops" });
  });

  it("serializes non-Error values to { code: 'Unknown', message: String(v) }", () => {
    expect(serializeError("string-err")).toEqual({ code: "Unknown", message: "string-err" });
    expect(serializeError(42)).toEqual({ code: "Unknown", message: "42" });
    expect(serializeError(null)).toEqual({ code: "Unknown", message: "null" });
  });
});