import { MERCHANT_RE, PORTAL_HEADER_NAMES } from '../constants';
import type { Cdp } from './cdp';
import { CHALLENGE_RE, grabIdCode, grabIdReason } from './grab-id';

/** What the login tab's network traffic has revealed so far — mutated by `watchNetwork`, read by the login loop. */
export interface NetworkWatch {
  /** Merchant id from the `merchantID` header of the portal's `api.grab.com` requests. */
  merchantId: string;
  /** Portal headers (`requestSource`, `x-client-id`…) seen on `api.grab.com` requests. */
  headers: Record<string, string>;
  /**
   * Grab ID API errors (`api.grab.com/grabid/v1/authnv4/*`) — the page just switches to a text screen
   * ("account not found" = 404) with no error element to detect. So we listen for HTTP status codes.
   */
  authFail: string;
  /** Challenge code Grab ID just demanded (puzzle / passkey…) — `''` if none yet. */
  challengeCode: string;
}

/** Listen to the tab's CDP Network events: portal headers + merchant id, and Grab ID failures / challenge codes. */
export function watchNetwork(tab: Cdp): NetworkWatch {
  const seen: NetworkWatch = { merchantId: '', headers: {}, authFail: '', challengeCode: '' };
  /** requestId → `HTTP 400 /grabid/…` of a failed response; waits for `loadingFinished` to read the error code from the body. */
  const failed = new Map<string, string>();
  tab.on((method, p) => {
    if (method === 'Network.responseReceived') {
      const res = p.response as { url: string; status: number };
      if (res.url.includes('/grabid/') && res.status >= 400) {
        const where = `HTTP ${res.status} ${new URL(res.url).pathname}`;
        seen.authFail = where;
        failed.set(p.requestId as string, where);
      }
      return;
    }
    if (method === 'Network.loadingFinished' && failed.has(p.requestId as string)) {
      const where = failed.get(p.requestId as string) ?? '';
      failed.delete(p.requestId as string);
      void tab
        .send<{ body: string }>('Network.getResponseBody', { requestId: p.requestId })
        .then((r) => {
          const code = grabIdCode(r.body);
          if (code) seen.authFail = `${grabIdReason(code)} — ${code}, ${where}`;
          if (CHALLENGE_RE.test(code)) seen.challengeCode = code;
        })
        .catch(() => undefined);
      return;
    }
    if (method !== 'Network.requestWillBeSent') return;
    const req = p.request as { url: string; headers: Record<string, string> };
    if (!req.url.startsWith('https://api.grab.com/')) return;
    for (const [k, v] of Object.entries(req.headers ?? {})) {
      const lk = k.toLowerCase();
      if (lk === 'merchantid' && MERCHANT_RE.test(v)) seen.merchantId = v;
      else if (PORTAL_HEADER_NAMES.includes(lk) || lk === 'merchantgroupid') seen.headers[k] = v;
    }
  });
  return seen;
}
