import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrabClient, GrabError, PageType } from '../src/index';

const session = {
  merchantId: '5-ABCDEFGH1234',
  cookie: 'mexusers_authn_token=jwt; mexusers_authn_token_jti=csrf-123',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const empty = (status: number) => new Response(null, { status });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = (logger?: (level: 'debug' | 'warn', msg: string) => void) =>
  new GrabClient(session, { retryDelaysMs: [0, 0], logger });

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e: unknown) => e as GrabError,
  );

describe('GrabClient.call — retries and error mapping', () => {
  it('retries 5xx with the configured delays, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(empty(504))
      .mockResolvedValueOnce(empty(502))
      .mockResolvedValueOnce(json({ ok: 1 }));
    const logger = vi.fn();
    await expect(client(logger).call('https://api.grab.com/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger.mock.calls[0][0]).toBe('warn');
  });

  it('gives up after the last retry with HTTP_ERROR + status', async () => {
    fetchMock.mockResolvedValue(empty(503));
    const err = await rejection(client().call('https://api.grab.com/x'));
    expect(err).toBeInstanceOf(GrabError);
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries network errors and reports NETWORK', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const err = await rejection(client().call('https://api.grab.com/x'));
    expect(err.code).toBe('NETWORK');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maps 401 to SESSION_EXPIRED without retrying', async () => {
    fetchMock.mockResolvedValue(empty(401));
    const err = await rejection(client().call('https://api.grab.com/x'));
    expect(err.code).toBe('SESSION_EXPIRED');
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 403 to FORBIDDEN without retrying', async () => {
    fetchMock.mockResolvedValue(empty(403));
    const err = await rejection(client().call('https://api.grab.com/x', { method: 'PUT', body: {} }));
    expect(err.code).toBe('FORBIDDEN');
    expect(err.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry 4xx', async () => {
    fetchMock.mockResolvedValue(empty(400));
    const err = await rejection(client().call('https://api.grab.com/x'));
    expect(err.code).toBe('HTTP_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for 204 and for non-JSON bodies', async () => {
    fetchMock.mockResolvedValueOnce(empty(204)).mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(client().call('https://api.grab.com/x')).resolves.toBeNull();
    await expect(client().call('https://api.grab.com/x')).resolves.toBeNull();
  });

  it('sends JSON bodies with the CSRF header on writes', async () => {
    fetchMock.mockResolvedValue(empty(204));
    await client().setItemsAvailable(['i1'], 2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.grab.com/food/merchant/v1/items/available-status');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ itemIDs: ['i1'], availableStatus: 2 });
    expect(init.headers['X-CSRF-Token']).toBe('csrf-123');
  });
});

describe('GrabClient — orders', () => {
  it('follows nextSearchToken until "|"', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ orders: [{ orderID: 'a' }], nextSearchToken: 't1' }))
      .mockResolvedValueOnce(json({ orders: [{ orderID: 'b' }], nextSearchToken: '|' }));
    const orders = await client().listActiveOrders(PageType.READY);
    expect(orders.map((o) => o.orderID)).toEqual(['a', 'b']);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('searchToken')).toBe('t1');
  });

  it('getOrders keeps per-order failures but rethrows SESSION_EXPIRED', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/bad') ? empty(404) : json({ id: url.split('/').pop() }),
    );
    const out = await client().getOrders(['o1', 'bad']);
    expect(out.find((b) => b.statement.ID === 'o1')?.detail).toEqual({ id: 'o1' });
    expect(out.find((b) => b.statement.ID === 'bad')).toMatchObject({ detail: null });

    fetchMock.mockResolvedValue(empty(401));
    const err = await rejection(client().getOrders(['o1']));
    expect(err.code).toBe('SESSION_EXPIRED');
  });

  it('isAlive is false on 401 and true on success', async () => {
    fetchMock.mockResolvedValueOnce(empty(401)).mockResolvedValueOnce(json({ statements: [], hasMore: false }));
    await expect(client().isAlive('2026-01-01')).resolves.toBe(false);
    await expect(client().isAlive('2026-01-01')).resolves.toBe(true);
  });
});
