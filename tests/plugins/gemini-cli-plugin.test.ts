import { describe, it, expect } from "vitest";
import { GeminiCliPlugin, GeminiConfigSchema, parseGeminiEvent } from "../../src/plugins/gemini-cli-plugin.js";

describe("GeminiCliPlugin - config and metadata", () => {
  it("has expected id and semver-like version", () => {
    const plugin = new GeminiCliPlugin();
    expect(plugin.id).toBe("gemini-cli");
    expect(plugin.version).toMatch(/^0\.\d+\.\d+$/);
  });

  it("config defaults are applied", () => {
    const parsed = GeminiConfigSchema.parse({});
    expect(parsed.cliPath).toBe("gemini");
    expect(parsed.model).toBe("gemini-2.5-pro");
    expect(parsed.apiKey).toBeUndefined();
  });

  it("metadata exposes skill tags", () => {
    const plugin = new GeminiCliPlugin();
    const { skills } = plugin.metadata();
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("gemini-cli");
    expect(skills[0].tags).toContain("code");
  });

  it("initialize accepts validated config", async () => {
    const plugin = new GeminiCliPlugin();
    const cfg = GeminiConfigSchema.parse({ cliPath: "/bin/echo", model: "x" });
    await expect(plugin.initialize(cfg)).resolves.toBeUndefined();
  });
});

describe("GeminiCliPlugin - lifecycle and execution guards", () => {
  it("throws error if execute is called before initialize", async () => {
    const plugin = new GeminiCliPlugin();
    const ctx = { taskId: "test-task", abortSignal: new AbortController().signal };
    const gen = plugin.execute({ parts: [{ kind: "text", text: "hi" }] }, ctx);
    await expect(gen.next()).rejects.toThrow("GeminiCliPlugin is not initialized");
  });

  it("dispose() resets initialization state", async () => {
    const plugin = new GeminiCliPlugin();
    await plugin.initialize(GeminiConfigSchema.parse({}));
    await plugin.dispose();
    const ctx = { taskId: "test-task", abortSignal: new AbortController().signal };
    const gen = plugin.execute({ parts: [{ kind: "text", text: "hi" }] }, ctx);
    await expect(gen.next()).rejects.toThrow("GeminiCliPlugin is not initialized");
  });
});

describe("parseGeminiEvent", () => {
  it("generates dynamic artifactId using taskId", () => {
    const event = { type: "text", text: "hello world" };
    const res = parseGeminiEvent(event, "task-123");
    expect(res).toEqual({
      kind: "artifact-update",
      artifact: {
        artifactId: "gemini-out-task-123",
        parts: [{ kind: "text", text: "hello world" }],
      },
    });
  });

  it("throws NonRetriableError for error events", () => {
    const event = { type: "error", message: "rate limit exceeded" };
    expect(() => parseGeminiEvent(event, "t")).toThrow("gemini: rate limit exceeded");
  });

  it("includes event details when message is missing or invalid", () => {
    const event = { type: "error", name: "INTERNAL_ERROR", foo: "bar" };
    expect(() => parseGeminiEvent(event, "t")).toThrow(/gemini: unknown error - .*INTERNAL_ERROR/);
  });
});
