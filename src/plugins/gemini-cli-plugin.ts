import { z } from "zod";
import type { A2APluginContext, A2APluginInterface } from "../core/plugin-interface.js";
import type { Message, StreamResponse } from "../core/a2a-types.js";
import { NonRetriableError } from "../core/errors.js";
import { runJsonLinesSubprocess } from "../core/helpers/subprocess.js";

export const GeminiConfigSchema = z.object({
  cliPath: z.string().default("gemini"),
  model: z.string().default("gemini-2.5-pro"),
  workingDir: z.string().optional(),
  apiKey: z.string().optional(),
});

export type GeminiConfig = z.infer<typeof GeminiConfigSchema>;

export class GeminiCliPlugin implements A2APluginInterface<GeminiConfig> {
  readonly id = "gemini-cli";
  readonly version = "0.1.0";
  readonly configSchema = GeminiConfigSchema;

  private config: GeminiConfig | null = null;

  async initialize(config: GeminiConfig): Promise<void> {
    this.config = config;
  }

  async dispose(): Promise<void> {
    this.config = null;
  }

  async *execute(message: Message, ctx: A2APluginContext): AsyncIterable<StreamResponse> {
    if (this.config === null) {
      throw new NonRetriableError("GeminiCliPlugin is not initialized");
    }

    const prompt = messageToPrompt(message);

    const env: Record<string, string> = {};
    if (this.config.apiKey !== undefined) {
      env.GEMINI_API_KEY = this.config.apiKey;
    }

    const proc = runJsonLinesSubprocess({
      cmd: this.config.cliPath,
      args: ["--json", "--model", this.config.model, "-"],
      ...(this.config.workingDir !== undefined ? { cwd: this.config.workingDir } : {}),
      env,
      abortSignal: ctx.abortSignal,
      stdin: prompt,
    });

    for await (const line of proc) {
      const event = parseGeminiEvent(line, ctx.taskId);
      if (event !== null) {
        yield event;
      }
    }
  }

  metadata(): { skills: Array<{ id: string; name: string; description: string; tags: string[] }> } {
    return {
      skills: [
        {
          id: "gemini-cli",
          name: "Gemini CLI",
          description: "Delegates execution to Gemini CLI and streams JSON-lines output",
          tags: ["code", "chat", "search"],
        },
      ],
    };
  }
}

type GeminiEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "error"; message: string; name?: string }
  | { type: string; [key: string]: unknown };

function messageToPrompt(message: Message): string {
  return message.parts
    .map((part) => {
      if (part.kind === "text") {
        return part.text;
      }
      return JSON.stringify(part);
    })
    .join("\n");
}

export function parseGeminiEvent(raw: unknown, taskId: string): StreamResponse | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const event = raw as GeminiEvent;

  switch (event.type) {
    case "text":
      if (typeof event.text !== "string") {
        return null;
      }
      return {
        kind: "artifact-update",
        artifact: {
          artifactId: `gemini-out-${taskId}`,
          parts: [{ kind: "text", text: event.text }],
        },
      };
    case "thinking":
      return null;
    case "error":
      if (typeof event.message !== "string") {
        const details = JSON.stringify({ type: event.type, name: event.name }, (k, v) =>
          v === undefined ? null : v,
        ).slice(0, 100);
        throw new NonRetriableError(`gemini: unknown error - ${details}`);
      }
      throw new NonRetriableError(`gemini: ${event.message}`);
    default:
      return null;
  }
}
