import type { PageType } from '../constants';
import { FOOD } from '../constants';
import { GrabError } from '../errors';
import type {
  GrabActiveOrder,
  GrabCallInit,
  GrabClientOptions,
  GrabOrderBundle,
  GrabSession,
  GrabStatement,
} from '../types';
import { callGrab, DEFAULT_RETRY_DELAYS_MS } from './http';
import { exportInventory, uploadInventory } from './inventory';
import { fetchMenu, putItemsAvailable, putModifiersAvailable } from './menu';
import { fetchActiveOrders, fetchOrderBundles, fetchStatements, markOrdersBody } from './orders';
import { sessionHeader, tokenExpiresAt } from './session';

/**
 * A Grab portal session — every call goes straight to `api.grab.com` with cookies, no browser needed.
 *
 * `api.grab.com` does not check IP or device, only the session cookie (+ `X-CSRF-Token` for writes).
 * The access token lives 2 days, then 401 → `SESSION_EXPIRED`; call `loginGrab` for a new session.
 */
export class GrabClient {
  private readonly retryDelays: number[];

  constructor(
    readonly session: GrabSession,
    private readonly options: GrabClientOptions = {},
  ) {
    this.retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  /** Current token expiry (ms) — log in again before this. */
  expiresAt(): number | null {
    return tokenExpiresAt(this.session.cookie);
  }

  /** Whether the session still works — fetches 1 report row for today. Network errors are thrown (NOT treated as expiry). */
  async isAlive(today: string): Promise<boolean> {
    try {
      await this.listStatements(today, today, { pageSize: 1, maxPages: 1 });
      return true;
    } catch (e) {
      if (e instanceof GrabError && e.code === 'SESSION_EXPIRED') return false;
      throw e;
    }
  }

  // ───────────── Orders ─────────────

  /**
   * Orders currently on the Orders screen — the ONLY place new orders appear immediately (History lags).
   * Each `PageType` is a tab of the screen (the portal queries `PreparingV2`, `Ready`, `Upcoming`).
   *
   * `autoAcceptGroup` = the store's auto-accept setting (`merchant.autoAcceptGroup`), e.g. `1` — a wrong
   * value yields HTTP 400. Next page via `nextSearchToken`; on the last page Grab returns `"|"`.
   * Empty body when there are no orders: `{orderStats:{}, pollInterval:300, nextSearchToken:"|"}`.
   */
  listActiveOrders(
    pageType: PageType,
    opts: { autoAcceptGroup?: number; size?: number } = {},
  ): Promise<GrabActiveOrder[]> {
    return fetchActiveOrders(this, this.session.merchantId, pageType, opts);
  }

  /** History screen over a date range (Vietnam time, `YYYY-MM-DD`) — auto-splits into ≤ 30-day windows + paginates. */
  listStatements(
    fromYmd: string,
    toYmd: string,
    opts: { pageSize?: number; maxPages?: number } = {},
  ): Promise<GrabStatement[]> {
    return fetchStatements(this, fromYmd, toYmd, opts);
  }

  /** Order detail — raw body (items, options, `fare`, `eater.comment`…). */
  getOrder(orderId: string): Promise<unknown> {
    return this.call(`${FOOD}/v3/orders/${encodeURIComponent(orderId)}`);
  }

  /**
   * Details for many orders, with bounded concurrency. One failed order doesn't fail the batch (its row gets
   * `detail: null`), EXCEPT an expired session — thrown immediately so the caller can log in again.
   */
  getOrders(ids: string[]): Promise<GrabOrderBundle[]> {
    return fetchOrderBundles(ids, (id) => this.getOrder(id));
  }

  /**
   * Mark orders like the portal buttons: `markStatus` 1 = food ready (notifies the driver) · 2 = seen / new order
   * acknowledged (enum `order-manager/constants/mark.ts`, bundle 8024). Body `{orderIDs, markStatus}` — `{orderID}`
   * returns 400; unknown order ids still get 204 (ignored). Food ready needs `preparationTaskIDs` (from
   * `listActiveOrders`) — without them Grab still returns 204 but the order does NOT change state.
   */
  async markOrders(orderIDs: string[], markStatus: 1 | 2, preparationTaskIDs: string[] = []): Promise<void> {
    if (orderIDs.length === 0) return;
    await this.call(`${FOOD}/orders/mark`, {
      method: 'POST',
      body: markOrdersBody(orderIDs, markStatus, preparationTaskIDs),
    });
  }

  // ───────────── Menu + inventory ─────────────

  /** Full menu: `categories[].items[]`, `modifierGroups[]`. */
  getMenu<T = unknown>(): Promise<T | null> {
    return fetchMenu<T>(this);
  }

  /**
   * Toggle items: 1 available · 2 sold out until next restock · 3 discontinued.
   * ⚠️ Grab does NOT disable items when stock hits 0 (they stay "available") — you must call this.
   */
  setItemsAvailable(itemIDs: string[], availableStatus: 1 | 2 | 3): Promise<void> {
    return putItemsAvailable(this, itemIDs, availableStatus);
  }

  /** Toggle modifiers — Grab has no stock count for modifiers, only available (1) / sold out (2). */
  setModifiersAvailable(modifierIDs: string[], availableStatus: 1 | 2): Promise<void> {
    return putModifiersAvailable(this, modifierIDs, availableStatus);
  }

  /** Current inventory export (CSV with 3 header rows) — patch the numbers and resubmit via `uploadInventoryCsv`. */
  exportInventoryCsv(): Promise<string> {
    return exportInventory(this);
  }

  /**
   * Bulk inventory import — three steps in the same order as the portal. Returns `taskID` to look up in the portal.
   * Retrying `POST /v1/bulktasks` is safe: the task only takes effect after `complete-uploading`.
   */
  uploadInventoryCsv(csv: string, fileName: string): Promise<string> {
    return uploadInventory(this, csv, fileName, sessionHeader(this.session, 'merchantGroupID'));
  }

  // ───────────── HTTP ─────────────

  /** Call `api.grab.com` with the session credentials, retrying on 5xx / network errors. */
  call<T>(url: string, init: GrabCallInit = {}): Promise<T | null> {
    return callGrab<T>(this.session, url, init, this.retryDelays, this.options.logger);
  }
}
