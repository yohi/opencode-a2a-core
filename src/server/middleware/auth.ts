import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export function bearerAuth(expectedToken: string): MiddlewareHandler {
  if (!expectedToken || expectedToken.trim() === '') {
    throw new Error('bearerAuth: expectedToken must be a non-empty string');
  }

  const expectedBuf = Buffer.from(expectedToken, 'utf-8');

  return async (c, next) => {
    const header = c.req.header('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = header.slice(7).trim();
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
