// JWT storage/decoding for the custom username/password auth scheme (see
// supabase/functions/moneyos). Mirrors the sibling workos-personal/portfolio
// projects' equivalent files.

const TOKEN_KEY = 'moneyos_token';

export interface TokenPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Decodes (but does not cryptographically verify) the token for UI state -
 *  real verification always happens server-side in the moneyos Edge Function. */
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
