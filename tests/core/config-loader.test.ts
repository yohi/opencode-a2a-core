import { describe, it, expect } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../src/core/config-loader.js";

const schema = z.object({
  port: z.number().positive(),
  host: z.string().min(1),
  enabled: z.boolean().optional(),
});

describe("loadConfig", () => {
  it("parses valid config", () => {
    const result = loadConfig({ port: 3000, host: "localhost" }, schema);
    expect(result).toEqual({ port: 3000, host: "localhost" });
  });

  it("applies defaults for optional fields", () => {
    const result = loadConfig({ port: 8080, host: "0.0.0.0" }, schema);
    expect(result).toEqual({ port: 8080, host: "0.0.0.0" });
  });

  it("throws on invalid config", () => {
    expect(() => loadConfig({ port: "not-a-number", host: "" }, schema)).toThrow();
  });
});
