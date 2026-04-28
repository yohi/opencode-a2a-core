import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { SubprocessError } from '../errors.js';

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
  opts: JsonLinesSubprocessOpts
): AsyncIterable<unknown> {
  const child = spawn(opts.cmd, opts.args, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  let completed = false;
  let spawnError: Error | undefined;

  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  // Prepare the close promise before consuming any streams to avoid race conditions.
  const closePromise = new Promise<number | null>((resolve, reject) => {
    child.on('close', (code) => {
      completed = true;
      resolve(code);
    });
    child.on('error', (err) => {
      completed = true;
      spawnError = err;
      reject(err);
    });
  });

  let sigkillTimer: NodeJS.Timeout | undefined;
  const abortHandler = () => {
    if (!completed) {
      child.kill('SIGTERM');
      if (sigkillTimer) {
        clearTimeout(sigkillTimer);
      }
      sigkillTimer = setTimeout(() => {
        if (!completed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }
  };

  if (opts.abortSignal.aborted) {
    abortHandler();
  }
  opts.abortSignal.addEventListener('abort', abortHandler);

  let timeoutTimer: NodeJS.Timeout | undefined;
  if (opts.timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      if (!completed) {
        abortHandler();
      }
    }, opts.timeoutMs);
  }

  const cleanup = () => {
    opts.abortSignal.removeEventListener('abort', abortHandler);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
    if (sigkillTimer) {
      clearTimeout(sigkillTimer);
      sigkillTimer = undefined;
    }
  };

  child.on('close', cleanup);
  child.on('error', cleanup);

  if (opts.stdin !== undefined) {
    child.stdin?.on('error', () => {}); // Handle EPIPE
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

  // Use the promise created earlier. If a spawn error occurred, it will be reflected here.
  const exitCode = await (spawnError
    ? Promise.reject(spawnError)
    : closePromise);

  if (exitCode !== 0) {
    throw new SubprocessError(exitCode ?? -1, stderr);
  }
}
