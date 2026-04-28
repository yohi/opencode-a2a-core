import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../src/core/config-loader.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/config.test.json", import.meta.url));

describe("loadConfig", () => {
  const original = process.env.FAKE_GEMINI_API_KEY;

  beforeEach(() => {
    process.env.FAKE_GEMINI_API_KEY = "secret-123";
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FAKE_GEMINI_API_KEY;
      return;
    }
    process.env.FAKE_GEMINI_API_KEY = original;
  });

  it("reads JSON and resolves ${env:VAR} placeholders", async () => {
    const cfg = await loadConfig(FIXTURE);
    const pluginCfg = cfg.plugins["gemini-cli"] as { apiKey?: string; model?: string };
    expect(pluginCfg.apiKey).toBe("secret-123");
    expect(pluginCfg.model).toBe("gemini-2.5-pro");
  });

  it("throws when ${env:VAR} is not set", async () => {
    delete process.env.FAKE_GEMINI_API_KEY;
    await expect(loadConfig(FIXTURE)).rejects.toThrow(/FAKE_GEMINI_API_KEY/);
  });

  it("returns an empty plugins map for a missing file", async () => {
    const cfg = await loadConfig("/tmp/does-not-exist-opencode-a2a.json");
    expect(cfg.plugins).toEqual({});
  });
});
