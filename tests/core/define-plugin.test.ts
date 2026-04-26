import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineA2APlugin } from "../../src/core/define-plugin.js";
import type { A2APluginInterface } from "../../src/core/plugin-interface.js";

describe("defineA2APlugin", () => {
  it("returns the input object unchanged and preserves typing", () => {
    const schema = z.object({ foo: z.string() });
    const plugin: A2APluginInterface<z.infer<typeof schema>> = {
      id: "test",
      version: "0.0.1",
      configSchema: schema,
      async initialize() {},
      async dispose() {},
      async *execute() {},
      metadata: () => ({
        skill: { id: "test", name: "Test", description: "t" },
      }),
    };
    const defined = defineA2APlugin(plugin);
    expect(defined).toBe(plugin);
    expect(defined.id).toBe("test");
  });
});
