export class A2AError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'A2AError';
  }
}

export class NonRetriableError extends A2AError {
  constructor(message: string, code = 'NonRetriable') {
    super(code, message);
    this.name = 'NonRetriableError';
  }
}

export class SubprocessError extends A2AError {
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super('SubprocessFailed', `subprocess failed with exit code ${exitCode}`);
    this.name = 'SubprocessError';
  }
}

export class TaskNotFoundError extends NonRetriableError {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`, 'TaskNotFound');
    this.name = 'TaskNotFoundError';
  }
}

export class PluginNotFoundError extends NonRetriableError {
  constructor(pluginId: string) {
    super(`Plugin not found: ${pluginId}`, 'PluginNotFound');
    this.name = 'PluginNotFoundError';
  }
}

export function serializeError(err: unknown): {
  code: string;
  message: string;
} {
  if (err instanceof A2AError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: 'Unknown', message: err.message };
  return { code: 'Unknown', message: String(err) };
}
