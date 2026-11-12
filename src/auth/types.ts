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
  /**
   * Path to Chrome / Chromium (e.g. `/usr/bin/chromium-browser`). Optional — when missing, `CHROME_PATH` is used,
   * then the usual install locations on macOS / Linux / Windows (see `findChromePath`).
   */
  chromePath?: string;
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
