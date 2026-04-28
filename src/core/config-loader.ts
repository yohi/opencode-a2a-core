import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const A2AConfigSchema = z.object({
  plugins: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

export type A2AConfig = z.infer<typeof A2AConfigSchema>;

const ENV_PLACEHOLDER = /\$\{env:([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export async function loadConfig(path: string): Promise<A2AConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return A2AConfigSchema.parse({});
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse config file at ${path}: ${err.message}`);
    }
    throw err;
  }

  const resolved = resolveEnvPlaceholders(parsed);
  return A2AConfigSchema.parse(resolved);
}

function resolveEnvPlaceholders(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_PLACEHOLDER, (_, name) => {
      const envValue = process.env[name];
      if (envValue === undefined) {
        throw new Error(`env var not set: ${name}`);
      }
      return envValue;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholders(item));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      out[key] = resolveEnvPlaceholders(nestedValue);
    }
    return out;
  }

  return value;
}
