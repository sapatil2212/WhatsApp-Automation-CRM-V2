import { randomBytes } from 'node:crypto';

/** URL-safe random token (about 144 bits). Used for public review URLs. */
export function newPublicToken(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

export const PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{16,40}$/;