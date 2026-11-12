/** Grab ID codes meaning "a human must do an extra step" (Arkose puzzle, passkey, selfie) — not bad credentials. */
export const CHALLENGE_RE =
  /CHALLENGE_SESSION_COMPLETION_REQUIRED|NOT_AMONG_ACCEPTED_CHALLENGES|PASSKEY_CHALLENGE|WEB_SELFIE/;

/** Grab ID API `{"code":"ERROR_CODE_…"}` → the code, or `''` if absent. */
export function grabIdCode(body: string): string {
  try {
    const code = (JSON.parse(body) as { code?: unknown }).code;
    return typeof code === 'string' || typeof code === 'number' ? String(code) : '';
  } catch {
    return '';
  }
}

/** Grab ID error code → human-readable reason. Codes taken from the weblogin bundle (`app.*.js`). */
const REASONS: Record<string, string> = {
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

/**
 * Grab ID error code → human-readable reason; unknown codes get a generic reason (the caller shows the code too).
 * `CHALLENGE_SESSION_COMPLETION_REQUIRED` = Grab demands an extra challenge (Arkose puzzle / passkey / selfie) — an
 * automated browser can't solve it; a human must.
 */
export function grabIdReason(code: string): string {
  return REASONS[code] ?? 'Grab reported an error';
}
