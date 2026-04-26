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
        skills: [{ id: "test", name: "Test", description: "t" }],
      }),
    };
    const defined = defineA2APlugin(plugin);
    expect(defined).toBe(plugin);
    expect(defined.id).toBe("test");
  });

  it("works with minimal plugin definition (optional config/hooks)", () => {
    const plugin: A2APluginInterface = {
      id: "minimal",
      version: "1.0.0",
      async *execute() {
        yield { kind: "task", task: { id: "123", status: { state: "TASK_STATE_COMPLETED" } } } as any;
      },
      metadata: () => ({ skills: [] }),
    };
    const defined = defineA2APlugin(plugin);
    expect(defined.configSchema).toBeUndefined();
    expect(defined.initialize).toBeUndefined();
    expect(defined.dispose).toBeUndefined();
  });

  it("verifies execute behavior as AsyncIterable", async () => {
    const mockResponse = { kind: "message", message: { role: "ROLE_AGENT", parts: [{ kind: "text", text: "hello" }] } } as any;
    const plugin: A2APluginInterface = {
      id: "stream-test",
      version: "1.0.0",
      async *execute() {
        yield mockResponse;
      },
      metadata: () => ({ skills: [] }),
    };

    const results = [];
    for await (const res of plugin.execute({ role: "ROLE_USER", parts: [] } as any, {} as any)) {
      results.push(res);
    }
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(mockResponse);
  });
});
