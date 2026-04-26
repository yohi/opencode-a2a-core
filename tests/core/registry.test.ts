import { describe, it, expect } from "vitest";
import { z } from "zod";
import { PluginRegistry } from "../../src/core/registry.js";
import type { A2APluginInterface } from "../../src/core/plugin-interface.js";

function makePlugin(id: string, opts: { initSpy?: (c: unknown) => void } = {}): A2APluginInterface {
  return {
    id,
    version: "0.0.1",
    configSchema: z.object({ foo: z.string().default("bar") }),
    async initialize(config) {
      opts.initSpy?.(config);
    },
    async dispose() {},
    async *execute() {},
    metadata: () => ({ skills: [{ id, name: id, description: "" }] }),
  };
}

describe("PluginRegistry", () => {
  it("register + get + list", () => {
    const reg = new PluginRegistry();
    const p = makePlugin("gemini-cli");
    reg.register(p);
    expect(reg.get("gemini-cli")).toBe(p);
    expect(reg.list()).toEqual([p]);
    expect(reg.get("missing")).toBeUndefined();
  });

  it("throws on duplicate id", () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("a"));
    expect(() => reg.register(makePlugin("a"))).toThrow(/duplicate/i);
  });

  it("initializeAll validates config via Zod and passes to plugin.initialize", async () => {
    const reg = new PluginRegistry();
    let seen: unknown;
    reg.register(makePlugin("x", { initSpy: (c) => (seen = c) }));
    await reg.initializeAll({ x: { foo: "hello" } });
    expect(seen).toEqual({ foo: "hello" });
  });

  it("initializeAll applies schema defaults when keys missing", async () => {
    const reg = new PluginRegistry();
    let seen: unknown;
    reg.register(makePlugin("y", { initSpy: (c) => (seen = c) }));
    await reg.initializeAll({});
    expect(seen).toEqual({ foo: "bar" });
  });

  it("initializeAll throws if config fails Zod validation", async () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("z"));
    await expect(reg.initializeAll({ z: { foo: 42 } })).rejects.toThrow();
  });

  it("initializeAll treats explicit null as null and fails Zod validation if not allowed", async () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("nulltest"));
    // Passing null should not be converted to {} and thus fail Zod validation
    await expect(
      reg.initializeAll({ nulltest: null as unknown as Record<string, unknown> })
    ).rejects.toThrow();
  });

  it("initializeAll rolls back (disposes) already initialized plugins on failure", async () => {
    const reg = new PluginRegistry();
    const state: string[] = [];

    const p1: A2APluginInterface = {
      ...makePlugin("p1"),
      async initialize() {
        state.push("init-p1");
      },
      async dispose() {
        state.push("dispose-p1");
      },
    };
    const p2: A2APluginInterface = {
      ...makePlugin("p2"),
      async initialize() {
        state.push("init-p2");
        throw new Error("p2-init-fail");
      },
      async dispose() {
        state.push("dispose-p2");
      },
    };

    reg.register(p1);
    reg.register(p2);

    await expect(reg.initializeAll({})).rejects.toThrow("p2-init-fail");

    // Order: p1 init, p2 init (fails), p1 dispose (rollback)
    expect(state).toEqual(["init-p1", "init-p2", "dispose-p1"]);
  });

  it("disposeAll calls every plugin's dispose", async () => {
    const reg = new PluginRegistry();
    const disposed: string[] = [];
    const p1: A2APluginInterface = {
      ...makePlugin("p1"),
      dispose: async () => void disposed.push("p1"),
    };
    const p2: A2APluginInterface = {
      ...makePlugin("p2"),
      dispose: async () => void disposed.push("p2"),
    };
    reg.register(p1);
    reg.register(p2);
    await reg.disposeAll();
    expect(disposed).toEqual(["p1", "p2"]);
  });

  it("initializeAll and disposeAll handle plugins without optional fields", async () => {
    const reg = new PluginRegistry();
    const minimalPlugin: A2APluginInterface = {
      id: "minimal",
      version: "0.0.1",
      async *execute() {},
      metadata: () => ({ skills: [] }),
    };
    reg.register(minimalPlugin);

    // Should not throw even if configSchema and initialize are missing
    await expect(reg.initializeAll({})).resolves.toBeUndefined();
    // Should not throw even if dispose is missing
    await expect(reg.disposeAll()).resolves.toBeUndefined();
  });

  it("disposeAll continues on error and throws AggregateError", async () => {
    const reg = new PluginRegistry();
    const disposed: string[] = [];

    const p1: A2APluginInterface = {
      ...makePlugin("p1"),
      dispose: async () => {
        throw new Error("p1 fail");
      },
    };
    const p2: A2APluginInterface = {
      ...makePlugin("p2"),
      dispose: async () => {
        disposed.push("p2");
      },
    };

    reg.register(p1);
    reg.register(p2);

    const promise = reg.disposeAll();
    await expect(promise).rejects.toThrow(AggregateError);
    await expect(promise).rejects.toThrow(/One or more plugins failed to dispose/);

    // Verify p2 was still disposed
    expect(disposed).toEqual(["p2"]);

    // Verify error collection
    try {
      await promise;
    } catch (err) {
      if (err instanceof AggregateError) {
        expect(err.errors).toHaveLength(1);
        expect(err.errors[0].message).toBe("p1 fail");
      } else {
        throw new Error("Expected AggregateError");
      }
    }
  });
});
