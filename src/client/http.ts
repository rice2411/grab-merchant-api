import { CSRF_COOKIE, TIMEOUT_MS } from '../constants';
import { GrabError } from '../errors';
import type { GrabCallInit, GrabClientOptions, GrabSession } from '../types';
import { sleep } from '../utils';
import { cookieValue } from './session';

/** Anything that can make an authenticated `api.grab.com` call — `GrabClient` itself. */
export interface GrabCaller {
  call<T>(url: string, init?: GrabCallInit): Promise<T | null>;
}

/** Default delays between retries on 5xx / network errors. */
export const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000];

/**
 * Worth retrying? ONLY 5xx and network errors. 401/403 mean a dead / forbidden session (retrying just
 * delays the signal), 400/404 mean a bad request — resending it unchanged fails again.
 */
export const worthRetry = (e: unknown): boolean =>
  e instanceof GrabError && (e.code === 'NETWORK' || (e.code === 'HTTP_ERROR' && (e.status ?? 0) >= 500));

/** Request headers for one call: portal headers + merchant id + cookie (+ `X-CSRF-Token` on writes). */
export function buildHeaders(session: GrabSession, method: string, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    ...(session.headers ?? {}),
    merchantID: session.merchantId,
    Accept: 'application/json',
    Cookie: session.cookie,
  };
  if (session.userAgent) headers['User-Agent'] = session.userAgent;
  if (hasBody) headers['Content-Type'] = 'application/json';
  const csrf = cookieValue(session.cookie, CSRF_COOKIE);
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

/** Call `api.grab.com` with the session credentials, retrying on 5xx / network errors. */
export async function callGrab<T>(
  session: GrabSession,
  url: string,
  init: GrabCallInit,
  retryDelays: number[],
  logger?: GrabClientOptions['logger'],
): Promise<T | null> {
  const method = init.method ?? 'GET';
  const headers = buildHeaders(session, method, init.body !== undefined);
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);

  for (let attempt = 0; ; attempt++) {
    // Timing: a 504 after a few seconds = Grab's circuit breaker; near 30s = their backend actually hung.
    const t0 = Date.now();
    try {
      return await fetchOnce<T>(url, method, body, headers);
    } catch (e) {
      const path = new URL(url).pathname;
      if (attempt >= retryDelays.length || !worthRetry(e)) throw e;
      logger?.(
        'warn',
        `Grab ${path} failed after ${Date.now() - t0}ms (${e instanceof Error ? e.message : String(e)}) — retry attempt ${attempt + 2}`,
      );
      await sleep(retryDelays[attempt]);
    }
  }
}

/** One HTTP round trip — maps 401/403/other statuses to `GrabError`; 204 / empty / non-JSON body → `null`. */
export async function fetchOnce<T>(
  url: string,
  method: string,
  body: string | undefined,
  headers: Record<string, string>,
): Promise<T | null> {
  const path = new URL(url).pathname;
  let res: Response;
  try {
    res = await fetch(url, { method, body, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new GrabError('NETWORK', `Could not reach Grab ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 401) throw new GrabError('SESSION_EXPIRED', `Grab returned HTTP 401 for ${method} ${path}`, 401);
  if (res.status === 403) throw new GrabError('FORBIDDEN', `Grab returned HTTP 403 for ${method} ${path}`, 403);
  if (!res.ok) throw new GrabError('HTTP_ERROR', `Grab returned HTTP ${res.status} for ${path}`, res.status);
  if (res.status === 204) return null;
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}
