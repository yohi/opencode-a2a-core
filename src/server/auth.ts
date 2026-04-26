import { timingSafeEqual, createHash } from 'crypto';

export interface BearerAuthOptions {
  tokens: string[];
}

export class BearerAuth {
  private hashedTokens: Buffer[];

  constructor(private options: BearerAuthOptions) {
    // Pre-hash tokens for constant-time comparison
    this.hashedTokens = options.tokens.map((token) =>
      createHash('sha256').update(token).digest(),
    );
  }

  validate(authHeader: string | undefined): boolean {
    if (!authHeader) return false;

    const match = authHeader.match(/^Bearer (.+)$/i);
    if (!match) return false;

    const token = match[1];
    const hashedToken = createHash('sha256').update(token).digest();

    // Constant-time comparison against all valid tokens
    return this.hashedTokens.some((validHash) => {
      try {
        return timingSafeEqual(hashedToken, validHash);
      } catch {
        // Length mismatch - timingSafeEqual throws
        return false;
      }
    });
  }
}
