export interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: string | number | null;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id?: string | number | null;
}

export class JSONRPCError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JSONRPCError';
    Object.setPrototypeOf(this, JSONRPCError.prototype);
  }
}

type Handler = (params: unknown) => Promise<unknown>;

export class JSONRPCRouter {
  private handlers = new Map<string, Handler>();

  register(method: string, handler: Handler): void {
    this.handlers.set(method, handler);
  }

  async route(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const handler = this.handlers.get(request.method);

    if (!handler) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Method not found',
        },
        id: request.id,
      };
    }

    try {
      const result = await handler(request.params);
      return {
        jsonrpc: '2.0',
        result,
        id: request.id,
      };
    } catch (err) {
      if (err instanceof JSONRPCError) {
        return {
          jsonrpc: '2.0',
          error: {
            code: err.code,
            message: err.message,
            data: err.data,
          },
          id: request.id,
        };
      }

      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal error',
        },
        id: request.id,
      };
    }
  }
}
