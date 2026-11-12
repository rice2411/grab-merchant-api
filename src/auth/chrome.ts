import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GrabError } from '../errors';

/** Inputs of `findChromePath` — injectable so detection can be tested without touching the real machine. */
export interface FindChromeEnv {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}

/** Usual Chrome / Chromium install locations for a platform, most common first. */
export function chromeCandidates(platform: NodeJS.Platform, env: Record<string, string | undefined> = {}): string[] {
  if (platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Chromium.app/Contents/MacOS/Chromium',
      'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ];
    return [...apps.map((a) => `/Applications/${a}`), ...apps.map((a) => join(homedir(), 'Applications', a))];
  }
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((r): r is string => !!r);
    return roots.flatMap((r) => [
      join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(r, 'Chromium', 'Application', 'chrome.exe'),
    ]);
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
  ];
}

/**
 * Find a Chrome / Chromium executable: `CHROME_PATH` first, then the usual install locations on macOS, Linux and
 * Windows. Throws `GrabError('LOGIN_FAILED')` when nothing is found (or `CHROME_PATH` points to a missing file).
 */
export function findChromePath(opts: FindChromeEnv = {}): string {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;
  const fromEnv = env.CHROME_PATH?.trim();
  if (fromEnv) {
    if (exists(fromEnv)) return fromEnv;
    throw new GrabError('LOGIN_FAILED', `CHROME_PATH is set to "${fromEnv}", but no file exists there.`);
  }
  const found = chromeCandidates(platform, env).find((p) => exists(p));
  if (found) return found;
  throw new GrabError(
    'LOGIN_FAILED',
    'Could not find Chrome or Chromium. Install one, or pass `chromePath` to loginGrab / set the CHROME_PATH environment variable.',
  );
}
