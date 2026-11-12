import { openBrowser, type Cdp } from './cdp';
import { DEFAULT_USER_AGENT, LOGIN_URL, MERCHANT_RE, PORTAL, PORTAL_HEADER_NAMES, TOKEN_COOKIE } from './constants';
import { GrabError } from './errors';
import type { GrabCredentials, GrabSession } from './types';

/**
 * Log in to the Grab Merchant portal with headless Chrome.
 *
 * Why a browser: `weblogin.grab.com` runs an anti-bot fingerprint (`hydra`) before accepting the
 * password — calling it bare from Node just earns a 403. So we let the page run itself, only fill the
 * fields + click buttons, and LISTEN over CDP: the `.grab.com` cookies once back on the portal, plus the
 * portal headers + merchant id from the first request to `api.grab.com`. Then Chrome is shut down —
 * everything after that (`GrabClient`) only needs the cookies.
 *
 * A session lives 2 days (`mexusers_authn_token`) and the portal has NO refresh path (per `main.js`)
 * — callers should call this function again before it expires.
 */

export type GrabLoginEvent =
  /** Current step — for showing progress in a UI. */
  | { type: 'step'; step: 'open' | 'username' | 'password' | 'submitted' | 'portal' }
  /** Grab asks for an OTP — the caller supplies it via `onOtp`. */
  | { type: 'otp'; hint: string }
  /** Grab demands an anti-bot challenge — a human solves it via `onChallenge`. */
  | { type: 'challenge'; code: string };

/** One frame of the login page (base64 JPEG) + viewport size. */
export interface GrabRemoteScreen {
  image: string;
  width: number;
  height: number;
}

/**
 * Remote control of the login browser — so a HUMAN can solve Grab's challenge (the library never solves it).
 * `click` coordinates are 0–1 fractions of the frame, independent of the displayed image size.
 */
export interface GrabRemote {
  screenshot(): Promise<GrabRemoteScreen>;
  click(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  key(key: GrabRemoteKey): Promise<void>;
  /**
   * Drag the mouse along EXACTLY the path the human just dragged on the frame (slider puzzle) — `x`/`y` as 0–1
   * fractions, `t` relative ms timestamps. It only replays the human's gesture, never computes a path itself.
   */
  drag(points: { x: number; y: number; t: number }[]): Promise<void>;
}

export type GrabRemoteKey = 'Enter' | 'Backspace' | 'Tab' | 'Escape';

export interface GrabLoginOptions {
  /** Path to Chrome / Chromium (e.g. `/usr/bin/chromium-browser`). */
  chromePath: string;
  onEvent?: (e: GrabLoginEvent) => void;
  /** Called to get the code when Grab asks for an OTP (e.g. wait for a human to enter it). Absent → `OTP_REQUIRED`. */
  onOtp?: (hint: string) => Promise<string>;
  /**
   * Grab demands an anti-bot challenge (`ERROR_CODE_CHALLENGE_SESSION_COMPLETION_REQUIRED`…) → keep the browser open,
   * hand a `GrabRemote` to a human to solve it; wait up to `challengeMs`. Absent → fail with `LOGIN_FAILED`.
   */
  onChallenge?: (remote: GrabRemote) => void;
  /** Time to wait for a human to solve the challenge (ms) — default 5 minutes, from when the challenge appears. */
  challengeMs?: number;
  /** Persistent Chrome profile (keeps the Grab ID device cookie between runs) — see `openBrowser`. */
  profileDir?: string;
  signal?: AbortSignal;
  /** Overall timeout (ms) — default 3 minutes (enough for a human to enter an OTP). */
  timeoutMs?: number;
  userAgent?: string;
}

/** Snapshot of the form state — read every tick to decide the next step. */
interface FormState {
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
const READ_FORM = `(() => {
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

const USER_INPUT = '#Username, input[name="username"], input[autocomplete="username"]';
const OTP_INPUT = 'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="otp" i], input[id*="otp" i]';

/** Click the submit button of the visible form (Continue / Log in / Verify…; Vietnamese labels included). */
const CLICK_SUBMIT = `(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && !b.disabled);
  const want = /tiếp tục|continue|đăng nhập|log ?in|sign ?in|xác nhận|verify|submit/i;
  const b = btns.find((x) => x.type === 'submit') || btns.find((x) => want.test(x.innerText || ''));
  if (b) { b.click(); return true; }
  return false;
})()`;

/** Analytics cookies — not credentials; dropped to keep the cookie string short (and avoid storing tracking data). */
const TRACKING = /^(_ga|_gid|_gcl|_fbp|_fbc|_hj|_uet|_twpid|visitor_id|OptanonConsent|OptanonAlertBoxClosed)/;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function loginGrab(creds: GrabCredentials, opts: GrabLoginOptions): Promise<GrabSession> {
  if (!creds.username || !creds.password) throw new GrabError('LOGIN_FAILED', 'Missing username or password');
  const userAgent = opts.userAgent || DEFAULT_USER_AGENT;
  let deadline = Date.now() + (opts.timeoutMs ?? 3 * 60_000);
  let browser;
  try {
    browser = await openBrowser(opts.chromePath, userAgent, opts.profileDir);
  } catch (e) {
    throw new GrabError('LOGIN_FAILED', `Could not launch Chrome: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { tab } = browser;
  try {
    // Portal headers + merchant id: taken from the requests the portal itself sends to api.grab.com after login.
    const seen = { merchantId: '', headers: {} as Record<string, string> };
    /**
     * Grab ID API errors (`api.grab.com/grabid/v1/authnv4/*`) — the page just switches to a text screen
     * ("account not found" = 404) with no error element to detect. So we listen for HTTP status codes.
     */
    let authFail = '';
    /** Challenge code Grab ID just demanded (puzzle / passkey…) — `''` if none yet. */
    let challengeCode = '';
    /** requestId → `HTTP 400 /grabid/…` of a failed response; waits for `loadingFinished` to read the error code from the body. */
    const failed = new Map<string, string>();
    tab.on((method, p) => {
      if (method === 'Network.responseReceived') {
        const res = p.response as { url: string; status: number };
        if (res.url.includes('/grabid/') && res.status >= 400) {
          const where = `HTTP ${res.status} ${new URL(res.url).pathname}`;
          authFail = where;
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
            if (code) authFail = `${grabIdReason(code)} — ${code}, ${where}`;
            if (CHALLENGE_RE.test(code)) challengeCode = code;
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

    opts.onEvent?.({ type: 'step', step: 'open' });
    await tab.send('Page.navigate', { url: LOGIN_URL });

    // Count fill attempts instead of a one-shot flag: Grab's weblogin is challenge-based (`authnv4`) —
    // the first step only sends the username, and a later step may show an EMPTY password field again.
    let userTries = 0;
    let passTries = 0;
    let otpRounds = 0;
    let lastSubmit = 0;
    /** When the page was first seen with no inputs — only an error if it lasts (step transitions are briefly empty too). */
    let blankSince = 0;
    /** Waiting for a human to solve the challenge — stop failing on blank page / challenge code, just wait for the portal. */
    let challenging = false;
    let last: FormState | null = null;
    for (;;) {
      if (opts.signal?.aborted) throw new GrabError('LOGIN_ABORTED', 'Grab login aborted');
      if (Date.now() > deadline) {
        throw new GrabError('LOGIN_FAILED', `Timed out waiting for Grab login (page: ${last ? `${last.path} — ${pageMessage(last.text)}` : '?'})`);
      }
      await sleep(700);
      const f = await tab.eval<FormState>(READ_FORM).catch(() => null);
      if (!f) continue; // page is navigating
      last = f;

      if (f.host === new URL(PORTAL).host) {
        if (await hasToken(tab)) break;
        continue;
      }
      blankSince = f.inputs === 0 ? blankSince || Date.now() : 0;
      // Solving a challenge: only stop if Grab reports a DIFFERENT error (e.g. wrong password after solving).
      if (challenging) {
        if (authFail && !challengeCode) throw new GrabError('LOGIN_FAILED', `Grab rejected the login: ${authFail}`);
        if (f.user && !f.userFilled && userTries < 3) {
          userTries++;
          await typeInto(tab, USER_INPUT, creds.username).catch(() => undefined);
        } else if (f.pass && !f.passFilled && passTries < 3) {
          passTries++;
          // After the challenge the page returns to an empty password field — fill + submit so the human needn't type it remotely.
          await typeInto(tab, 'input[type="password"]', creds.password).catch(() => undefined);
          await tab.eval(CLICK_SUBMIT).catch(() => undefined);
        }
        continue;
      }
      // Report errors after submitting (wrong account / password, locked…) — don't wait for the timeout.
      if (lastSubmit && Date.now() - lastSubmit > 1500 && (authFail || f.error || (blankSince && Date.now() - blankSince > 4000))) {
        // Wait one more tick for the error body (Grab ID error code) before reporting.
        await sleep(800);
        if (challengeCode && opts.onChallenge) {
          // Grab wants a challenge: the page shows it itself — keep the browser and hand control to a human.
          challenging = true;
          deadline = Date.now() + (opts.challengeMs ?? 5 * 60_000);
          opts.onEvent?.({ type: 'challenge', code: challengeCode });
          opts.onChallenge(remoteOf(tab));
          // Clear the markers so a DIFFERENT error after solving (wrong password…) still gets reported; repeated challenge codes are ignored.
          authFail = '';
          challengeCode = '';
          continue;
        }
        throw new GrabError('LOGIN_FAILED', authFail ? `Grab rejected the login: ${authFail}` : `Grab rejected the login: ${f.error || pageMessage(f.text)}`);
      }
      if (f.otp) {
        if (!opts.onOtp) throw new GrabError('OTP_REQUIRED', 'Grab requires an OTP');
        if (otpRounds++ >= 3) throw new GrabError('LOGIN_FAILED', 'Wrong OTP entered more than 3 times');
        opts.onEvent?.({ type: 'otp', hint: pageMessage(f.text) });
        const code = (await opts.onOtp(pageMessage(f.text))).trim();
        if (!code) throw new GrabError('OTP_REQUIRED', 'No OTP provided');
        await typeInto(tab, OTP_INPUT, code);
        await tab.eval(CLICK_SUBMIT);
        lastSubmit = Date.now();
        continue;
      }
      if (f.user && !f.userFilled) {
        if (userTries++ >= 3) throw new GrabError('LOGIN_FAILED', 'Grab login page did not accept the username');
        opts.onEvent?.({ type: 'step', step: 'username' });
        await typeInto(tab, USER_INPUT, creds.username);
        // Two-step form (username → Continue → password): if the password field isn't shown yet, click Continue.
        if (!f.pass) {
          await tab.eval(CLICK_SUBMIT);
          lastSubmit = Date.now();
        }
        continue;
      }
      if (f.pass && !f.passFilled) {
        if (passTries++ >= 3) throw new GrabError('LOGIN_FAILED', 'Grab login page did not accept the password');
        opts.onEvent?.({ type: 'step', step: 'password' });
        await typeInto(tab, 'input[type="password"]', creds.password);
        await tab.eval(CLICK_SUBMIT);
        lastSubmit = Date.now();
        opts.onEvent?.({ type: 'step', step: 'submitted' });
      }
    }

    opts.onEvent?.({ type: 'step', step: 'portal' });
    // Wait for the portal's first api.grab.com call (carrying merchantID). If none, open the Orders page directly.
    for (let i = 0; i < 20 && !seen.merchantId; i++) await sleep(500);
    if (!seen.merchantId) {
      await tab.send('Page.navigate', { url: `${PORTAL}/food/order` });
      for (let i = 0; i < 30 && !seen.merchantId; i++) {
        await sleep(500);
        const href = await tab.eval<string>('location.pathname').catch(() => '');
        const m = /\/order\/([0-9]+-[A-Z0-9]{8,})/.exec(href);
        if (m) seen.merchantId = m[1];
      }
    }
    if (!seen.merchantId) seen.merchantId = (await tab.eval<string | null>(MERCHANT_FROM_STORAGE).catch(() => null)) ?? '';
    if (!seen.merchantId) throw new GrabError('LOGIN_FAILED', 'Logged in but could not find the merchant id');

    return { merchantId: seen.merchantId, cookie: await grabCookies(tab), headers: seen.headers, userAgent };
  } finally {
    await browser.dispose();
  }
}

/** Grab ID codes meaning "a human must do an extra step" (Arkose puzzle, passkey, selfie) — not bad credentials. */
const CHALLENGE_RE = /CHALLENGE_SESSION_COMPLETION_REQUIRED|NOT_AMONG_ACCEPTED_CHALLENGES|PASSKEY_CHALLENGE|WEB_SELFIE/;

/** `GrabRemote.key` key → CDP key code. */
const KEYS: Record<GrabRemoteKey, { code: string; keyCode: number }> = {
  Enter: { code: 'Enter', keyCode: 13 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
};

/** Control the tab over CDP: capture frames, dispatch real mouse input (the challenge lives in a cross-origin iframe — JS `click()` can't reach it). */
function remoteOf(tab: Cdp): GrabRemote {
  const viewport = async () => {
    const m = await tab.send<{ cssVisualViewport: { clientWidth: number; clientHeight: number } }>('Page.getLayoutMetrics');
    return { width: Math.round(m.cssVisualViewport.clientWidth), height: Math.round(m.cssVisualViewport.clientHeight) };
  };
  return {
    screenshot: async () => {
      const [{ data }, size] = await Promise.all([
        tab.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 60 }),
        viewport(),
      ]);
      return { image: data, ...size };
    },
    click: async (x, y) => {
      const { width, height } = await viewport();
      const px = Math.max(0, Math.min(1, x)) * width;
      const py = Math.max(0, Math.min(1, y)) * height;
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py });
      await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
    },
    type: async (text) => {
      await tab.send('Input.insertText', { text });
    },
    drag: async (points) => {
      if (points.length < 2) return;
      const { width, height } = await viewport();
      const at = (p: { x: number; y: number }) => ({ x: Math.max(0, Math.min(1, p.x)) * width, y: Math.max(0, Math.min(1, p.y)) * height });
      const first = at(points[0]);
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...first });
      await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...first, button: 'left', buttons: 1, clickCount: 1 });
      // Replay the human's EXACT timing (gaps between points), clamping each gap to ≤ 200 ms.
      for (let i = 1; i < points.length; i++) {
        const gap = Math.max(0, Math.min(200, points[i].t - points[i - 1].t));
        if (gap > 0) await new Promise((r) => setTimeout(r, gap));
        await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at(points[i]), button: 'left', buttons: 1 });
      }
      const last = at(points[points.length - 1]);
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...last, button: 'left', buttons: 0, clickCount: 1 });
    },
    key: async (key) => {
      const k = KEYS[key];
      const base = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
      await tab.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (key === 'Enter') await tab.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' });
      await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
  };
}

/** The weblogin page's message line — skips the fixed marketing taglines at the top (English + Vietnamese). */
function pageMessage(text: string): string {
  const skip = /phát triển kinh doanh|truy cập tiện lợi|business made easier|easy access|convenient access|grow your business|all the tools/i;
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !skip.test(l))[0] ?? 'unknown reason';
}

/** Grab ID API `{"code":"ERROR_CODE_…"}` → the code, or `''` if absent. */
function grabIdCode(body: string): string {
  try {
    const code = (JSON.parse(body) as { code?: unknown }).code;
    return typeof code === 'string' || typeof code === 'number' ? String(code) : '';
  } catch {
    return '';
  }
}

/**
 * Grab ID error code → human-readable reason. Codes taken from the weblogin bundle (`app.*.js`). Unknown codes are shown verbatim.
 * `CHALLENGE_SESSION_COMPLETION_REQUIRED` = Grab demands an extra challenge (Arkose puzzle / passkey / selfie) — an
 * automated browser can't solve it; a human must.
 */
function grabIdReason(code: string): string {
  const reasons: Record<string, string> = {
    ERROR_CODE_USER_NOT_FOUND: 'account not found — check the username',
    ERROR_CODE_PHONE_NUMBER_NOT_FOUND: 'phone number not found',
    ERROR_CODE_EXCEEDED_MAX_ATTEMPTS: 'too many failed attempts — temporarily locked by Grab, wait and retry',
    ERROR_CODE_USER_ACCOUNT_BLOCKED: 'account blocked by Grab',
    ERROR_CODE_CHALLENGE_SESSION_COMPLETION_REQUIRED: 'Grab requires extra verification (anti-bot challenge / passkey)',
    ERROR_CODE_NOT_AMONG_ACCEPTED_CHALLENGES: 'Grab requires a different verification method',
    ERROR_CODE_PASSKEY_CHALLENGE_VERIFICATION_REQUIRED: 'Grab requires passkey verification',
    ERROR_CODE_WEB_SELFIE_NOT_ACCEPTED: 'Grab requires selfie verification',
    ERROR_CODE_PWD_EXPIRED: 'password expired — change it on Grab',
    ERROR_CODE_PWD_NOT_SETUP: 'account has no password set',
    ERROR_CODE_PWD_SETUP_REQUIRED: 'Grab requires a password reset',
    ERROR_CODE_POSSIBLE_DEVICE_CLOCK_DRIFT: 'server clock drift',
    ERROR_CODE_CHALLENGE_SESSION_EXPIRED: 'login session expired — try again',
    ERROR_CODE_CHALLENGE_EXPIRED: 'verification code expired — try again',
  };
  return reasons[code] ?? 'Grab reported an error';
}

/** Merchant id from localStorage/sessionStorage — last-resort fallback. */
const MERCHANT_FROM_STORAGE = `(() => {
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
async function typeInto(tab: Cdp, selector: string, text: string): Promise<void> {
  const ok = await tab.eval<boolean>(`(() => {
    const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.offsetParent !== null);
    if (!e) return false;
    e.focus(); e.select && e.select();
    return true;
  })()`);
  if (!ok) throw new GrabError('LOGIN_FAILED', `Field ${selector} not found on the Grab login page`);
  await tab.send('Input.insertText', { text });
}

async function hasToken(tab: Cdp): Promise<boolean> {
  const { cookies } = await tab.send<{ cookies: { name: string; value: string }[] }>('Network.getAllCookies');
  return cookies.some((c) => c.name === TOKEN_COOKIE && c.value);
}

/** `.grab.com` cookies as `a=1; b=2`, minus analytics cookies; on name clashes the `.grab.com` one wins. */
async function grabCookies(tab: Cdp): Promise<string> {
  const { cookies } = await tab.send<{ cookies: { name: string; value: string; domain: string }[] }>('Network.getAllCookies');
  const byName = new Map<string, string>();
  const mine = cookies
    .filter((c) => c.domain.endsWith('grab.com') && !TRACKING.test(c.name))
    .sort((a, b) => (a.domain === '.grab.com' ? 1 : 0) - (b.domain === '.grab.com' ? 1 : 0));
  for (const c of mine) byName.set(c.name, c.value);
  return [...byName].map(([k, v]) => `${k}=${v}`).join('; ');
}
