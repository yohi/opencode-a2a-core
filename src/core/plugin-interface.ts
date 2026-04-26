import type { z } from "zod";
import type { Message, StreamResponse } from "./a2a-types.js";
import type { Logger } from "./logger.js";

export interface A2APluginContext {
  logger: Logger;
  abortSignal: AbortSignal;
  taskId: string;
  contextId?: string;
}

export interface A2APluginSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

export interface A2APluginInterface<TConfig = unknown> {
  readonly id: string;
  readonly version: string;
  readonly configSchema: z.ZodType<TConfig>;

  initialize(config: TConfig): Promise<void>;
  dispose(): Promise<void>;

  execute(message: Message, ctx: A2APluginContext): AsyncIterable<StreamResponse>;

  metadata(): { skill: A2APluginSkill };
}
