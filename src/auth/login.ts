import { DEFAULT_USER_AGENT, LOGIN_URL, PORTAL } from '../constants';
import { GrabError } from '../errors';
import type { GrabCredentials, GrabSession } from '../types';
import { sleep } from '../utils';
import { openBrowser } from './cdp';
import { findChromePath } from './chrome';
import { watchNetwork } from './network';
import {
  CLICK_SUBMIT,
  type FormState,
  grabCookies,
  hasToken,
  MERCHANT_FROM_STORAGE,
  OTP_INPUT,
  pageMessage,
  READ_FORM,
  typeInto,
  USER_INPUT,
} from './page';
import { remoteOf } from './remote';
import type { GrabLoginOptions } from './types';

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
export async function loginGrab(creds: GrabCredentials, opts: GrabLoginOptions = {}): Promise<GrabSession> {
  if (!creds.username || !creds.password) throw new GrabError('LOGIN_FAILED', 'Missing username or password');
  const userAgent = opts.userAgent || DEFAULT_USER_AGENT;
  const chromePath = opts.chromePath || findChromePath();
  let deadline = Date.now() + (opts.timeoutMs ?? 3 * 60_000);
  let browser;
  try {
    browser = await openBrowser(chromePath, userAgent, opts.profileDir);
  } catch (e) {
    throw new GrabError('LOGIN_FAILED', `Could not launch Chrome: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { tab } = browser;
  try {
    // Portal headers + merchant id: taken from the requests the portal itself sends to api.grab.com after login.
    const net = watchNetwork(tab);

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
        throw new GrabError(
          'LOGIN_FAILED',
          `Timed out waiting for Grab login (page: ${last ? `${last.path} — ${pageMessage(last.text)}` : '?'})`,
        );
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
        if (net.authFail && !net.challengeCode) {
          throw new GrabError('LOGIN_FAILED', `Grab rejected the login: ${net.authFail}`);
        }
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
      if (
        lastSubmit &&
        Date.now() - lastSubmit > 1500 &&
        (net.authFail || f.error || (blankSince && Date.now() - blankSince > 4000))
      ) {
        // Wait one more tick for the error body (Grab ID error code) before reporting.
        await sleep(800);
        if (net.challengeCode && opts.onChallenge) {
          // Grab wants a challenge: the page shows it itself — keep the browser and hand control to a human.
          challenging = true;
          deadline = Date.now() + (opts.challengeMs ?? 5 * 60_000);
          opts.onEvent?.({ type: 'challenge', code: net.challengeCode });
          opts.onChallenge(remoteOf(tab));
          // Clear the markers so a DIFFERENT error after solving (wrong password…) still gets reported; repeated challenge codes are ignored.
          net.authFail = '';
          net.challengeCode = '';
          continue;
        }
        throw new GrabError(
          'LOGIN_FAILED',
          net.authFail
            ? `Grab rejected the login: ${net.authFail}`
            : `Grab rejected the login: ${f.error || pageMessage(f.text)}`,
        );
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
    for (let i = 0; i < 20 && !net.merchantId; i++) await sleep(500);
    if (!net.merchantId) {
      await tab.send('Page.navigate', { url: `${PORTAL}/food/order` });
      for (let i = 0; i < 30 && !net.merchantId; i++) {
        await sleep(500);
        const href = await tab.eval<string>('location.pathname').catch(() => '');
        const m = /\/order\/([0-9]+-[A-Z0-9]{8,})/.exec(href);
        if (m) net.merchantId = m[1];
      }
    }
    if (!net.merchantId)
      net.merchantId = (await tab.eval<string | null>(MERCHANT_FROM_STORAGE).catch(() => null)) ?? '';
    if (!net.merchantId) throw new GrabError('LOGIN_FAILED', 'Logged in but could not find the merchant id');

    return { merchantId: net.merchantId, cookie: await grabCookies(tab), headers: net.headers, userAgent };
  } finally {
    await browser.dispose();
  }
}
