import { z } from 'zod';
import { defineA2APlugin } from '../core/define-plugin.js';
import { runJsonLinesSubprocess } from '../core/helpers/subprocess.js';
import type { A2APluginInterface, A2APluginContext } from '../core/plugin-interface.js';
import type { Message, StreamResponse } from '../core/a2a-types.js';

const GeminiConfigSchema = z.object({
  cliPath: z.string().default('gemini'),
  model: z.string().default('gemini-2.5-pro'),
  workingDir: z.string().optional(),
  apiKey: z.string().optional(),
});

type GeminiConfig = z.infer<typeof GeminiConfigSchema>;

export class GeminiCliPlugin implements A2APluginInterface<GeminiConfig> {
  readonly id = 'gemini-cli';
  readonly version = '0.1.0';
  readonly configSchema = GeminiConfigSchema;

  private config!: GeminiConfig;

  async initialize(config: GeminiConfig): Promise<void> {
    this.config = config;
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }

  async *execute(message: Message, ctx: A2APluginContext): AsyncIterable<StreamResponse> {
    const prompt = this.messageToPrompt(message);

    const proc = runJsonLinesSubprocess({
      cmd: this.config.cliPath,
      args: ['--json', '--model', this.config.model, '-'],
      cwd: this.config.workingDir,
      env: this.config.apiKey ? { GEMINI_API_KEY: this.config.apiKey } : undefined,
      abortSignal: ctx.abortSignal,
      stdin: prompt,
    });

    for await (const line of proc) {
      const evt = this.parseGeminiEvent(line, ctx);
      if (evt) yield evt;
    }
  }

  metadata() {
    return {
      skill: {
        id: 'gemini-cli',
        name: 'Gemini CLI',
        description: 'Delegates to Google Gemini CLI',
        tags: ['code', 'chat', 'search'],
        examples: ['Generate a React component', 'Summarize this file'],
      },
    };
  }

  private messageToPrompt(m: Message): string {
    // Convert message parts to CLI prompt
    return m.parts
      .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
      .map((p) => p.text)
      .join('\n');
  }

  private parseGeminiEvent(raw: unknown, ctx: A2APluginContext): StreamResponse | null {
    if (typeof raw !== 'object' || raw === null) return null;

    const obj = raw as Record<string, unknown>;

    // Handle different Gemini CLI output formats
    if (obj.type === 'text' && typeof obj.text === 'string') {
      return {
        kind: 'message',
        message: {
          role: 'ROLE_AGENT',
          parts: [{ kind: 'text', text: obj.text }],
        },
      };
    }

    if (obj.type === 'thinking') {
      // Don't yield thinking - log only (headless principle)
      ctx.logger.debug('Gemini thinking', { content: obj.content });
      return null;
    }

    return null;
  }
}

// Default export
export default defineA2APlugin(new GeminiCliPlugin());
