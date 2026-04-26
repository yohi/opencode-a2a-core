import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { runJsonLinesSubprocess } from "../../../src/core/helpers/subprocess.js";
import { SubprocessError } from "../../../src/core/errors.js";

const FIXTURE = fileURLToPath(
  new URL("../../fixtures/json-lines-echo.mjs", import.meta.url),
);

async function drain(it: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("runJsonLinesSubprocess", () => {
  it("yields parsed JSON lines in order", async () => {
    const ctl = new AbortController();
    const lines = await drain(
      runJsonLinesSubprocess({
        cmd: process.execPath,
        args: [FIXTURE, "3"],
        abortSignal: ctl.signal,
        stdin: "hello",
      }),
    );
    expect(lines).toHaveLength(3);
    expect((lines[0] as { index: number }).index).toBe(0);
    expect((lines[2] as { input: string }).input).toBe("hello");
  });

  it("throws SubprocessError on non-zero exit", async () => {
    const ctl = new AbortController();
    const it = runJsonLinesSubprocess({
      cmd: process.execPath,
      args: [FIXTURE, "1", "7", "stderr"],
      abortSignal: ctl.signal,
      stdin: "x",
    });
    await expect(drain(it)).rejects.toThrow(SubprocessError);
  });

  it("aborts via AbortSignal (sends SIGTERM)", async () => {
    const ctl = new AbortController();
    const it = runJsonLinesSubprocess({
      cmd: process.execPath,
      // Use a long sleep so abort definitely interrupts it
      args: [FIXTURE, "1", "0", "", "5000"],
      abortSignal: ctl.signal,
      stdin: "x",
    });
    
    // Abort before it can finish naturally
    queueMicrotask(() => ctl.abort());
    
    // Expect rejection due to abort
    await expect(drain(it)).rejects.toThrow();
  }, 5000);

  it("terminates via timeoutMs", async () => {
    const ctl = new AbortController();
    const it = runJsonLinesSubprocess({
      cmd: process.execPath,
      // Sleep for 2s, but timeout at 100ms
      args: [FIXTURE, "1", "0", "", "2000"],
      abortSignal: ctl.signal,
      stdin: "x",
      timeoutMs: 100,
    });
    
    const start = Date.now();
    // Rejects with SubprocessError because it's terminated with SIGTERM/SIGKILL (non-zero or null exit)
    await expect(drain(it)).rejects.toThrow(SubprocessError);
    const duration = Date.now() - start;
    
    expect(duration).toBeGreaterThanOrEqual(100);
    expect(duration).toBeLessThan(2000);
  });
});
