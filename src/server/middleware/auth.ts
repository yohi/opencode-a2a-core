import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export function bearerAuth(expectedToken: string): MiddlewareHandler {
  const expectedBuf = Buffer.from(expectedToken, 'utf-8');

  return async (c, next) => {
    const header = c.req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = header.slice(7);
    const tokenBuf = Buffer.from(token, 'utf-8');

    const isLengthMatch = tokenBuf.length === expectedBuf.length;
    const compareBuf = isLengthMatch
      ? tokenBuf
      : Buffer.alloc(expectedBuf.length);
    const isEqual = timingSafeEqual(compareBuf, expectedBuf) && isLengthMatch;

    if (!isEqual) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    await next();
  };
}
