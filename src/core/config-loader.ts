import { readFile } from "node:fs/promises";
import { z } from "zod";

export const A2AConfigSchema = z.object({
  plugins: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

export type A2AConfig = z.infer<typeof A2AConfigSchema>;

const ENV_PLACEHOLDER = /^\$\{env:([A-Z_][A-Z0-9_]*)\}$/;

export async function loadConfig(path: string): Promise<A2AConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return A2AConfigSchema.parse({});
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as unknown;
  const resolved = resolveEnvPlaceholders(parsed);
  return A2AConfigSchema.parse(resolved);
}

function resolveEnvPlaceholders(value: unknown): unknown {
  if (typeof value === "string") {
    const match = ENV_PLACEHOLDER.exec(value);
    if (!match) {
      return value;
    }

    const name = match[1];
    const envValue = process.env[name];
    if (envValue === undefined) {
      throw new Error(`env var not set: ${name}`);
    }
    return envValue;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholders(item));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      out[key] = resolveEnvPlaceholders(nestedValue);
    }
    return out;
  }

  return value;
}
