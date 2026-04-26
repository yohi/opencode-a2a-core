export type SSEWriteFn = (chunk: string) => void | Promise<void>;

export class SSEWriter {
  constructor(private write: SSEWriteFn) {}

  writeEvent(event: string, data: unknown): void {
    this.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  writeError(error: { code: number; message: string }): void {
    this.writeEvent('error', error);
  }

  done(): void {
    this.write('event: done\ndata: {}\n\n');
  }
}
