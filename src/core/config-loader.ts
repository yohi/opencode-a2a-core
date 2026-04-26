import { z } from "zod";

export function loadConfig<T extends z.ZodTypeAny>(
  raw: unknown,
  schema: T,
): z.infer<T> {
  return schema.parse(raw);
}

export const ServerConfigSchema = z.object({
  port: z.number().positive(),
  host: z.string().min(1),
  enabled: z.boolean().default(true),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function loadServerConfig(raw: unknown): ServerConfig {
  return loadConfig(raw, ServerConfigSchema);
}
