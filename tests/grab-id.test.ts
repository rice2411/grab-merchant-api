import { describe, expect, it } from 'vitest';
import { CHALLENGE_RE, grabIdCode, grabIdReason } from '../src/auth/grab-id';

describe('grabIdCode', () => {
  it('extracts the code from a Grab ID error body', () => {
    expect(grabIdCode('{"code":"ERROR_CODE_USER_NOT_FOUND","message":"x"}')).toBe('ERROR_CODE_USER_NOT_FOUND');
    expect(grabIdCode('{"code":4001}')).toBe('4001');
  });

  it('returns "" for bodies without a usable code', () => {
    expect(grabIdCode('not json')).toBe('');
    expect(grabIdCode('{}')).toBe('');
    expect(grabIdCode('{"code":{"nested":true}}')).toBe('');
  });
});

describe('grabIdReason', () => {
  it('maps known codes to readable reasons', () => {
    expect(grabIdReason('ERROR_CODE_USER_NOT_FOUND')).toBe('account not found — check the username');
    expect(grabIdReason('ERROR_CODE_EXCEEDED_MAX_ATTEMPTS')).toMatch(/too many failed attempts/);
    expect(grabIdReason('ERROR_CODE_PWD_EXPIRED')).toMatch(/password expired/);
  });

  it('falls back to a generic reason for unknown codes', () => {
    expect(grabIdReason('ERROR_CODE_SOMETHING_NEW')).toBe('Grab reported an error');
  });
});

describe('CHALLENGE_RE', () => {
  it('matches codes that need a human, not bad credentials', () => {
    expect(CHALLENGE_RE.test('ERROR_CODE_CHALLENGE_SESSION_COMPLETION_REQUIRED')).toBe(true);
    expect(CHALLENGE_RE.test('ERROR_CODE_PASSKEY_CHALLENGE_VERIFICATION_REQUIRED')).toBe(true);
    expect(CHALLENGE_RE.test('ERROR_CODE_WEB_SELFIE_NOT_ACCEPTED')).toBe(true);
    expect(CHALLENGE_RE.test('ERROR_CODE_USER_NOT_FOUND')).toBe(false);
  });
});
