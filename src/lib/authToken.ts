/**
 * Browser-side storage and inspection of the session JWT.
 *
 * MoneyOS issues its own tokens rather than using Supabase Auth; the signing
 * and verification live in the edge function.
 *
 * @module auth
 */

const TOKEN_KEY = 'moneyos_token';

export interface TokenPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

/** @public */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** @public */
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** @public */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Reads the token payload for UI state, and returns null once it has expired.
 *
 * The signature is deliberately not checked here: nothing the client decides
 * from this is trusted. Every request is verified server-side.
 *
 * @public
 */
export function decodeToken(token: string): TokenPayload | null {
  try {
    const payloadSegment = token.split('.')[1];
    const json = atob(payloadSegment.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
