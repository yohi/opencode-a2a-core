export class A2AError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "A2AError";
  }
}

export class NonRetriableError extends A2AError {
  constructor(message: string) {
    super("NonRetriable", message);
    this.name = "NonRetriableError";
  }
}

export class SubprocessError extends A2AError {
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super("SubprocessFailed", `subprocess exited with ${exitCode}: ${stderr}`);
    this.name = "SubprocessError";
  }
}

export function serializeError(err: unknown): { code: string; message: string } {
  if (err instanceof A2AError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: "Unknown", message: err.message };
  return { code: "Unknown", message: String(err) };
}