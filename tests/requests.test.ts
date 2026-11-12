import { describe, expect, it } from 'vitest';
import { buildHeaders } from '../src/client/http';
import { activeOrdersQuery, markOrdersBody, statementsQuery } from '../src/client/orders';
import { PageType } from '../src/constants';

const session = {
  merchantId: '5-ABCDEFGH1234',
  cookie: 'mexusers_authn_token=jwt; mexusers_authn_token_jti=csrf-123',
  headers: { requestSource: 'troyPortal', 'x-client-id': 'abc' },
  userAgent: 'UA/1.0',
};

describe('activeOrdersQuery', () => {
  it('builds the orders-pagination query with defaults', () => {
    const qs = activeOrdersQuery(session.merchantId, PageType.PREPARING_V2, '');
    expect(qs.toString()).toBe('AutoAcceptGroup=1&merchantID=5-ABCDEFGH1234&PageType=PreparingV2&searchToken=&size=50');
  });

  it('passes the search token and custom options through', () => {
    const qs = activeOrdersQuery(session.merchantId, PageType.READY, 'tok|1', { autoAcceptGroup: 2, size: 10 });
    expect(Object.fromEntries(qs)).toEqual({
      AutoAcceptGroup: '2',
      merchantID: '5-ABCDEFGH1234',
      PageType: 'Ready',
      searchToken: 'tok|1',
      size: '10',
    });
  });
});

describe('statementsQuery', () => {
  it('builds the daily-pagination query in Vietnam time', () => {
    expect(Object.fromEntries(statementsQuery('2026-01-01', '2026-01-30', 3, 5))).toEqual({
      states: '',
      startTime: '2026-01-01T00:00:00+07:00',
      endTime: '2026-01-30T23:59:59+07:00',
      pageIndex: '3',
      pageSize: '5',
    });
    expect(statementsQuery('2026-01-01', '2026-01-01', 0).get('pageSize')).toBe('50');
  });
});

describe('buildHeaders', () => {
  it('sends session headers, merchant id, cookie and user agent on reads, without CSRF', () => {
    const h = buildHeaders(session, 'GET', false);
    expect(h).toMatchObject({
      requestSource: 'troyPortal',
      'x-client-id': 'abc',
      merchantID: session.merchantId,
      Accept: 'application/json',
      Cookie: session.cookie,
      'User-Agent': 'UA/1.0',
    });
    expect(h['X-CSRF-Token']).toBeUndefined();
    expect(h['Content-Type']).toBeUndefined();
  });

  it('adds X-CSRF-Token from the jti cookie and Content-Type on writes', () => {
    const h = buildHeaders(session, 'PUT', true);
    expect(h['X-CSRF-Token']).toBe('csrf-123');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('omits X-CSRF-Token when the cookie has no jti', () => {
    const h = buildHeaders({ merchantId: '5-X', cookie: 'mexusers_authn_token=jwt' }, 'POST', true);
    expect(h['X-CSRF-Token']).toBeUndefined();
    expect(h['User-Agent']).toBeUndefined();
  });
});

describe('markOrdersBody', () => {
  it('includes preparationTaskIDs only when given', () => {
    expect(markOrdersBody(['o1'], 2)).toEqual({ orderIDs: ['o1'], markStatus: 2 });
    expect(markOrdersBody(['o1'], 1, ['o1-PREP-1'])).toEqual({
      orderIDs: ['o1'],
      markStatus: 1,
      preparationTaskIDs: ['o1-PREP-1'],
    });
  });
});
