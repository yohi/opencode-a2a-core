import { describe, it, expect } from "vitest";
import { z } from "zod";
import { PluginRegistry } from "../../src/core/registry.js";

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
    metadata: () => ({ skill: { id, name: id, description: "" } }),
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
});