import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { GeminiCliPlugin, GeminiConfigSchema } from "../../src/plugins/gemini-cli-plugin.js";
import { silentLogger, drain, mkMessage } from "../core/_helpers.js";
import type { StreamResponse } from "../../src/core/a2a-types.js";

const FAKE_CLI = fileURLToPath(new URL("../fixtures/fake-gemini-cli.mjs", import.meta.url));

describe("GeminiCliPlugin (integration)", () => {
  it("executes fake CLI and yields text artifact-update while dropping thinking", async () => {
    const plugin = new GeminiCliPlugin();
    const cfg = GeminiConfigSchema.parse({ cliPath: FAKE_CLI, model: "fake-model" });
    await plugin.initialize(cfg);

    const ctl = new AbortController();
    const out = (await drain(
      plugin.execute(mkMessage(), {
        logger: silentLogger(),
        abortSignal: ctl.signal,
        taskId: "t-1",
      }),
    )) as StreamResponse[];

    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("artifact-update");

    if (out[0].kind !== "artifact-update") {
      throw new Error("Expected artifact-update");
    }

    const firstPart = out[0].artifact.parts[0];
    expect(firstPart.kind).toBe("text");
    if (firstPart.kind === "text") {
      expect(firstPart.text).toMatch(/^echo: hi/);
    }
  });
});
