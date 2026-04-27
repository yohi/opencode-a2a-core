import { z } from "zod";
import type { A2APluginInterface } from "../../src/core/plugin-interface.js";
import type { Message, StreamResponse } from "../../src/core/a2a-types.js";
import { ConsoleLogger, type Logger } from "../../src/core/logger.js";

export function silentLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

export function mkMessage(): Message {
  return { role: "ROLE_USER", parts: [{ kind: "text", text: "hi" }] };
}

export function mkPlugin(
  id: string,
  exec: (msg: Message, ctx: { abortSignal: AbortSignal }) => AsyncIterable<StreamResponse>,
): A2APluginInterface {
  return {
    id,
    version: "0.0.1",
    configSchema: z.object({}).passthrough(),
    async initialize() {},
    async dispose() {},
    execute: exec,
    metadata: () => ({ skill: { id, name: id, description: "" } }),
  };
}

export async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

export { ConsoleLogger };
