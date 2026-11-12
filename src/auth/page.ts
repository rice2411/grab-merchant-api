import { TOKEN_COOKIE } from '../constants';
import { GrabError } from '../errors';
import type { Cdp } from './cdp';

/**
 * Everything that reads or drives the weblogin page itself: the form snapshot, the submit click, field typing,
 * the portal's cookies and the merchant-id fallback. Selectors match input attributes (Grab's classes are hashed).
 */

/** Snapshot of the form state — read every tick to decide the next step. */
export interface FormState {
  host: string;
  path: string;
  user: boolean;
  userFilled: boolean;
  pass: boolean;
  passFilled: boolean;
  otp: boolean;
  /** Number of visible inputs — weblogin's error page ("account not found") has none. */
  inputs: number;
  error: string;
  text: string;
}

/** Expression that reads the form — matches input attributes, not classes (Grab's classes are hashed). */
export const READ_FORM = `(() => {
  const vis = (e) => !!e && e.offsetParent !== null && !e.disabled;
  const user = document.querySelector('#Username, input[name="username"], input[autocomplete="username"]');
  const pass = [...document.querySelectorAll('input[type="password"]')].find(vis);
  const otp = [...document.querySelectorAll('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="otp" i], input[id*="otp" i]')].find(vis);
  const err = [...document.querySelectorAll('[role="alert"], [class*="error" i], [class*="Error"]')]
    .map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 200)[0] || '';
  return {
    host: location.host, path: location.pathname,
    user: vis(user), userFilled: !!(user && user.value),
    pass: !!pass, passFilled: !!(pass && pass.value),
    otp: !!otp, error: err,
    inputs: [...document.querySelectorAll('input')].filter(vis).filter((e) => e.type !== 'radio' && e.type !== 'hidden').length,
    text: (document.body && document.body.innerText || '').slice(0, 300),
  };
})()`;

export const USER_INPUT = '#Username, input[name="username"], input[autocomplete="username"]';
export const OTP_INPUT =
  'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="otp" i], input[id*="otp" i]';

/** Click the submit button of the visible form (Continue / Log in / Verify…; Vietnamese labels included). */
export const CLICK_SUBMIT = `(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && !b.disabled);
  const want = /tiếp tục|continue|đăng nhập|log ?in|sign ?in|xác nhận|verify|submit/i;
  const b = btns.find((x) => x.type === 'submit') || btns.find((x) => want.test(x.innerText || ''));
  if (b) { b.click(); return true; }
  return false;
})()`;

/** Analytics cookies — not credentials; dropped to keep the cookie string short (and avoid storing tracking data). */
const TRACKING = /^(_ga|_gid|_gcl|_fbp|_fbc|_hj|_uet|_twpid|visitor_id|OptanonConsent|OptanonAlertBoxClosed)/;

/** The weblogin page's message line — skips the fixed marketing taglines at the top (English + Vietnamese). */
export function pageMessage(text: string): string {
  const skip =
    /phát triển kinh doanh|truy cập tiện lợi|business made easier|easy access|convenient access|grow your business|all the tools/i;
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !skip.test(l))[0] ?? 'unknown reason'
  );
}

/** Merchant id from localStorage/sessionStorage — last-resort fallback. */
export const MERCHANT_FROM_STORAGE = `(() => {
  for (const s of [localStorage, sessionStorage]) {
    for (let i = 0; i < s.length; i++) {
      const raw = s.getItem(s.key(i)) || '';
      if (raw.length > 100000) continue;
      const m = raw.match(/[0-9]+-[A-Z0-9]{8,}/);
      if (m) return m[0];
    }
  }
  return null;
})()`;

/** Fill a React input: focus + `Input.insertText` (real typing, so the page's `onChange` fires). */
export async function typeInto(tab: Cdp, selector: string, text: string): Promise<void> {
  const ok = await tab.eval<boolean>(`(() => {
    const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.offsetParent !== null);
    if (!e) return false;
    e.focus(); e.select && e.select();
    return true;
  })()`);
  if (!ok) throw new GrabError('LOGIN_FAILED', `Field ${selector} not found on the Grab login page`);
  await tab.send('Input.insertText', { text });
}

export async function hasToken(tab: Cdp): Promise<boolean> {
  const { cookies } = await tab.send<{ cookies: { name: string; value: string }[] }>('Network.getAllCookies');
  return cookies.some((c) => c.name === TOKEN_COOKIE && c.value);
}

/** `.grab.com` cookies as `a=1; b=2`, minus analytics cookies; on name clashes the `.grab.com` one wins. */
export async function grabCookies(tab: Cdp): Promise<string> {
  const { cookies } = await tab.send<{ cookies: { name: string; value: string; domain: string }[] }>(
    'Network.getAllCookies',
  );
  const byName = new Map<string, string>();
  const mine = cookies
    .filter((c) => c.domain.endsWith('grab.com') && !TRACKING.test(c.name))
    .sort((a, b) => (a.domain === '.grab.com' ? 1 : 0) - (b.domain === '.grab.com' ? 1 : 0));
  for (const c of mine) byName.set(c.name, c.value);
  return [...byName].map(([k, v]) => `${k}=${v}`).join('; ');
}
