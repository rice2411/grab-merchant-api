import { describe, expect, it } from 'vitest';
import { cookieValue, tokenExpiresAt } from '../src/client/session';
import { sessionHeader } from '../src/client/session';

const jwt = (payload: object) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

describe('cookieValue', () => {
  const cookie = 'a=1; mexusers_authn_token=abc.def; b = two ; empty=; c=x=y';

  it('returns the value of a named cookie', () => {
    expect(cookieValue(cookie, 'a')).toBe('1');
    expect(cookieValue(cookie, 'mexusers_authn_token')).toBe('abc.def');
  });

  it('trims whitespace around names and values', () => {
    expect(cookieValue(cookie, 'b')).toBe('two');
  });

  it('keeps "=" inside values and returns empty values as ""', () => {
    expect(cookieValue(cookie, 'c')).toBe('x=y');
    expect(cookieValue(cookie, 'empty')).toBe('');
  });

  it('returns null for missing cookies and does not match prefixes', () => {
    expect(cookieValue(cookie, 'missing')).toBeNull();
    expect(cookieValue(cookie, 'mexusers_authn')).toBeNull();
    expect(cookieValue('', 'a')).toBeNull();
  });
});

describe('tokenExpiresAt', () => {
  it('reads exp (seconds) from the access-token JWT and returns ms', () => {
    const cookie = `x=1; mexusers_authn_token=${jwt({ exp: 1_800_000_000 })}`;
    expect(tokenExpiresAt(cookie)).toBe(1_800_000_000_000);
  });

  it('returns null when the token cookie is missing', () => {
    expect(tokenExpiresAt('a=1')).toBeNull();
  });

  it('returns null for malformed tokens or missing / invalid exp', () => {
    expect(tokenExpiresAt('mexusers_authn_token=notajwt')).toBeNull();
    expect(tokenExpiresAt('mexusers_authn_token=a.!!!.c')).toBeNull();
    expect(tokenExpiresAt(`mexusers_authn_token=${jwt({ sub: 'x' })}`)).toBeNull();
    expect(tokenExpiresAt(`mexusers_authn_token=${jwt({ exp: -5 })}`)).toBeNull();
    expect(tokenExpiresAt(`mexusers_authn_token=${jwt({ exp: 'soon' })}`)).toBeNull();
  });
});

describe('sessionHeader', () => {
  it('looks up session headers case-insensitively', () => {
    const session = { merchantId: '5-X', cookie: '', headers: { merchantGroupID: 'G-1' } };
    expect(sessionHeader(session, 'merchantgroupid')).toBe('G-1');
    expect(sessionHeader(session, 'missing')).toBe('');
    expect(sessionHeader({ merchantId: '5-X', cookie: '' }, 'merchantGroupID')).toBe('');
  });
});
