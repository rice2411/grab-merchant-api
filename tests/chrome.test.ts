import { describe, expect, it } from 'vitest';
import { chromeCandidates, findChromePath } from '../src/auth/chrome';
import { GrabError } from '../src/errors';

const only =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);

describe('findChromePath', () => {
  it('prefers CHROME_PATH when it exists', () => {
    const path = findChromePath({
      env: { CHROME_PATH: '/opt/my/chrome' },
      platform: 'linux',
      exists: only('/opt/my/chrome', '/usr/bin/chromium'),
    });
    expect(path).toBe('/opt/my/chrome');
  });

  it('throws LOGIN_FAILED when CHROME_PATH points to a missing file', () => {
    expect(() => findChromePath({ env: { CHROME_PATH: '/nope' }, platform: 'linux', exists: () => false })).toThrow(
      /CHROME_PATH/,
    );
  });

  it('falls back to common Linux locations', () => {
    expect(findChromePath({ env: {}, platform: 'linux', exists: only('/usr/bin/chromium-browser') })).toBe(
      '/usr/bin/chromium-browser',
    );
  });

  it('finds Chrome on macOS', () => {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(findChromePath({ env: {}, platform: 'darwin', exists: only(mac) })).toBe(mac);
  });

  it('builds Windows candidates from Program Files / LocalAppData', () => {
    const list = chromeCandidates('win32', {
      PROGRAMFILES: 'C:\\Program Files',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    });
    expect(list.some((p) => p.includes('Program Files') && p.endsWith('chrome.exe'))).toBe(true);
    expect(list.some((p) => p.includes('AppData') && p.endsWith('chrome.exe'))).toBe(true);
  });

  it('throws GrabError LOGIN_FAILED when nothing is found', () => {
    try {
      findChromePath({ env: {}, platform: 'linux', exists: () => false });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GrabError);
      expect((e as GrabError).code).toBe('LOGIN_FAILED');
    }
  });
});
