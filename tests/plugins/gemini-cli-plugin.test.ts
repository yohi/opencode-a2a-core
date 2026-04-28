import { describe, it, expect } from "vitest";
import { GeminiCliPlugin, GeminiConfigSchema } from "../../src/plugins/gemini-cli-plugin.js";

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
