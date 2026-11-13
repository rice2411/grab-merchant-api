/** Error from Grab or from the library itself. `code` lets callers branch (e.g. session expired → log in again). */
export class GrabError extends Error {
  constructor(
    readonly code: GrabErrorCode,
    message: string,
    /** HTTP status returned by Grab, if any. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GrabError';
  }
}

export type GrabErrorCode =
  /** 401 — the `mexusers_authn_token` token expired (valid 2 days, cannot be refreshed) → call `loginGrab` again. */
  | 'SESSION_EXPIRED'
  /** 403 — session is alive but this call is blocked (missing permission / missing `X-CSRF-Token`). Logging in again will NOT fix it. */
  | 'FORBIDDEN'
  /** Other HTTP status (5xx, 400…). `status` is set. */
  | 'HTTP_ERROR'
  /** Network error / timeout. */
  | 'NETWORK'
  | 'BAD_RESPONSE'
  /** Inventory CSV layout not recognised (no `ITEMID` / `CURRENTSTOCK` column) — Grab changed the export format. */
  | 'CSV_SHAPE'
  /** Login failed (wrong password, Chrome failed to launch, cookie not found…). */
  | 'LOGIN_FAILED'
  /** Grab asked for an OTP but the caller did not provide one (`onOtp` missing / returned empty). */
  | 'OTP_REQUIRED'
  /** Caller aborted the login (`signal`). */
  | 'LOGIN_ABORTED';
