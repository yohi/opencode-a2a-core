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
  readonly #stderr: string;

  constructor(
    public readonly exitCode: number,
    stderr: string,
  ) {
    super("SubprocessFailed", `subprocess failed with exit code ${exitCode}`);
    this.#stderr = stderr;
    this.name = "SubprocessError";
  }

  /**
   * Returns the raw stderr output.
   * This is marked as private to prevent accidental leakage during serialization.
   */
  get rawStderr(): string {
    return this.#stderr;
  }
}

export function serializeError(err: unknown): { code: string; message: string } {
  if (err instanceof SubprocessError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof A2AError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: "Unknown", message: err.message };
  return { code: "Unknown", message: String(err) };
}
