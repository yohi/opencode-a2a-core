import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface JsonLinesSubprocessOpts {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  abortSignal: AbortSignal;
  stdin?: string | Uint8Array;
  timeoutMs?: number;
}

export class SubprocessError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`Subprocess exited with code ${exitCode}: ${stderr}`);
    this.name = "SubprocessError";
  }
}

export async function* runJsonLinesSubprocess(
  opts: JsonLinesSubprocessOpts,
): AsyncIterable<unknown> {
  const child = spawn(opts.cmd, opts.args, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  let completed = false;

  child.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  const abortHandler = () => {
    if (!completed) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }
  };
  opts.abortSignal.addEventListener("abort", abortHandler);

  if (opts.stdin) {
    child.stdin?.write(opts.stdin);
    child.stdin?.end();
  }

  const rl = createInterface({ input: child.stdout! });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // Skip non-JSON lines
      }
    }
  } finally {
    opts.abortSignal.removeEventListener("abort", abortHandler);
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      completed = true;
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    throw new SubprocessError(exitCode, stderr);
  }
}
