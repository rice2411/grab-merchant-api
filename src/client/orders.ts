import type { PageType } from '../constants';
import { DELV } from '../constants';
import { GrabError } from '../errors';
import type { GrabActiveOrder, GrabOrderBundle, GrabStatement } from '../types';
import { sleep } from '../utils';
import { dateWindows, vnEnd, vnStart } from './dates';
import type { GrabCaller } from './http';

const PAGE_SIZE = 50;
const MAX_PAGES = 200;
/** Max pages read from the Orders screen per `listActiveOrders` call. */
const MAX_ACTIVE_PAGES = 20;
/** Max parallel order-detail fetches — roughly what the portal itself does. */
const DETAIL_CONCURRENCY = 4;

export interface ActiveOrdersOptions {
  autoAcceptGroup?: number;
  size?: number;
}

/** Query string of `v4/orders-pagination` for one page. */
export function activeOrdersQuery(
  merchantId: string,
  pageType: PageType,
  searchToken: string,
  opts: ActiveOrdersOptions = {},
): URLSearchParams {
  return new URLSearchParams({
    AutoAcceptGroup: String(opts.autoAcceptGroup ?? 1),
    merchantID: merchantId,
    PageType: pageType,
    searchToken,
    size: String(opts.size ?? PAGE_SIZE),
  });
}

/** Query string of `v1/reports/daily-pagination` for one page of one window. */
export function statementsQuery(fromYmd: string, toYmd: string, pageIndex: number, pageSize?: number): URLSearchParams {
  return new URLSearchParams({
    states: '',
    startTime: vnStart(fromYmd),
    endTime: vnEnd(toYmd),
    pageIndex: String(pageIndex),
    pageSize: String(pageSize ?? PAGE_SIZE),
  });
}

/** Every page of one Orders-screen tab; stops on an empty page or the `"|"` end token. */
export async function fetchActiveOrders(
  api: GrabCaller,
  merchantId: string,
  pageType: PageType,
  opts: ActiveOrdersOptions = {},
): Promise<GrabActiveOrder[]> {
  const out: GrabActiveOrder[] = [];
  let token = '';
  for (let page = 0; page < MAX_ACTIVE_PAGES; page++) {
    const qs = activeOrdersQuery(merchantId, pageType, token, opts);
    const data = await api.call<{ orders?: GrabActiveOrder[]; nextSearchToken?: string }>(
      `${DELV}/v4/orders-pagination?${qs}`,
    );
    const batch = data?.orders ?? [];
    out.push(...batch);
    token = data?.nextSearchToken ?? '';
    if (batch.length === 0 || !token || token === '|') break;
  }
  return out;
}

/** History rows over a date range — split into ≤ 30-day windows, each paginated. */
export async function fetchStatements(
  api: GrabCaller,
  fromYmd: string,
  toYmd: string,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<GrabStatement[]> {
  const all: GrabStatement[] = [];
  for (const [from, to] of dateWindows(fromYmd, toYmd)) {
    for (let pageIndex = 0; pageIndex < (opts.maxPages ?? MAX_PAGES); pageIndex++) {
      const qs = statementsQuery(from, to, pageIndex, opts.pageSize);
      const data = await api.call<{ statements?: GrabStatement[]; hasMore?: boolean }>(
        `${DELV}/v1/reports/daily-pagination?${qs}`,
      );
      all.push(...(data?.statements ?? []));
      if (!data?.hasMore) break;
      await sleep(200);
    }
  }
  return all;
}

/**
 * Details for many orders, with bounded concurrency. One failed order doesn't fail the batch (its row gets
 * `detail: null`), EXCEPT an expired session — thrown immediately so the caller can log in again.
 */
export async function fetchOrderBundles(
  ids: string[],
  getOrder: (id: string) => Promise<unknown>,
): Promise<GrabOrderBundle[]> {
  const out: GrabOrderBundle[] = [];
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        out.push({ statement: { ID: id }, detail: await getOrder(id), error: null });
      } catch (e) {
        if (e instanceof GrabError && e.code === 'SESSION_EXPIRED') throw e;
        out.push({ statement: { ID: id }, detail: null, error: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, ids.length) }, worker));
  return out;
}

/** Body of `POST /orders/mark` — `preparationTaskIDs` only when given. */
export function markOrdersBody(orderIDs: string[], markStatus: 1 | 2, preparationTaskIDs: string[] = []) {
  return preparationTaskIDs.length ? { orderIDs, markStatus, preparationTaskIDs } : { orderIDs, markStatus };
}
