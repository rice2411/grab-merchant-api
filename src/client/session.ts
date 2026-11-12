import { TOKEN_COOKIE } from '../constants';
import type { GrabSession } from '../types';

/** Value of a cookie in an `a=1; b=2` string — null if absent. */
export function cookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Access token expiry (`exp` of the `mexusers_authn_token` JWT), in ms. `null` if unreadable. */
export function tokenExpiresAt(cookie: string): number | null {
  const jwt = cookieValue(cookie, TOKEN_COOKIE);
  const payload = jwt?.split('.')[1];
  if (!payload) return null;
  try {
    const exp = Number((JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: unknown }).exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Session header by name, case-insensitive — `''` if absent. */
export function sessionHeader(session: GrabSession, name: string): string {
  const k = Object.keys(session.headers ?? {}).find((h) => h.toLowerCase() === name.toLowerCase());
  return k ? (session.headers?.[k] ?? '') : '';
}
