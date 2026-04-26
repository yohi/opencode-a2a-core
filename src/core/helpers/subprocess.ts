import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { SubprocessError } from "../errors.js";

export interface JsonLinesSubprocessOpts {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  abortSignal: AbortSignal;
  stdin?: string | Uint8Array;
  timeoutMs?: number;
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
  let spawnError: Error | undefined;

  child.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  child.on("error", (err) => {
    completed = true;
    spawnError = err;
  });

  const abortHandler = () => {
    if (!completed) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!completed) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }
  };
  
  opts.abortSignal.addEventListener("abort", abortHandler);
  
  let timeoutTimer: NodeJS.Timeout | undefined;
  if (opts.timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      if (!completed) {
        abortHandler();
      }
    }, opts.timeoutMs);
  }

  const cleanup = () => {
    opts.abortSignal.removeEventListener("abort", abortHandler);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
  };

  if (opts.stdin !== undefined) {
    child.stdin?.write(opts.stdin);
    child.stdin?.end();
  } else {
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
    cleanup();
  }

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    if (spawnError) {
      return reject(spawnError);
    }
    child.on("close", (code) => {
      completed = true;
      resolve(code);
    });
    child.on("error", (err) => {
      completed = true;
      reject(err);
    });
  });

  if (exitCode !== 0) {
    throw new SubprocessError(exitCode ?? -1, stderr);
  }
}
