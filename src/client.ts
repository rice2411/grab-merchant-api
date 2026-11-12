import { CSRF_COOKIE, DELV, FOOD, PageType, TIMEOUT_MS, TOKEN_COOKIE } from './constants';
import { GrabError } from './errors';
import type {
  GrabActiveOrder,
  GrabCallInit,
  GrabClientOptions,
  GrabOrderBundle,
  GrabSession,
  GrabStatement,
} from './types';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Value of a cookie in an `a=1; b=2` string — null if absent. */
export function cookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Access token expiry (`exp` of the `mexusers_authn_token` JWT), in ms. `null` if unreadable. */
export function tokenExpiresAt(cookie: string): number | null {
  const jwt = cookieValue(cookie, TOKEN_COOKIE);
  const payload = jwt?.split('.')[1];
  if (!payload) return null;
  try {
    const exp = Number((JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: unknown }).exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Worth retrying? ONLY 5xx and network errors. 401/403 mean a dead / forbidden session (retrying just
 * delays the signal), 400/404 mean a bad request — resending it unchanged fails again.
 */
const worthRetry = (e: unknown): boolean =>
  e instanceof GrabError && (e.code === 'NETWORK' || (e.code === 'HTTP_ERROR' && (e.status ?? 0) >= 500));

/** `YYYY-MM-DD` date → start/end of day in Vietnam time (UTC+7), as Grab's report API expects. */
const vnStart = (ymd: string) => `${ymd}T00:00:00+07:00`;
const vnEnd = (ymd: string) => `${ymd}T23:59:59+07:00`;

/** Grab's max range per report query (longer ranges are split into windows). */
const MAX_RANGE_DAYS = 30;
const PAGE_SIZE = 50;
const MAX_PAGES = 200;
/** Max parallel order-detail fetches — roughly what the portal itself does. */
const DETAIL_CONCURRENCY = 4;

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
    this.retryDelays = options.retryDelaysMs ?? [2_000, 5_000];
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
  async listActiveOrders(pageType: PageType, opts: { autoAcceptGroup?: number; size?: number } = {}): Promise<GrabActiveOrder[]> {
    const out: GrabActiveOrder[] = [];
    let token = '';
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({
        AutoAcceptGroup: String(opts.autoAcceptGroup ?? 1),
        merchantID: this.session.merchantId,
        PageType: pageType,
        searchToken: token,
        size: String(opts.size ?? PAGE_SIZE),
      });
      const data = await this.call<{ orders?: GrabActiveOrder[]; nextSearchToken?: string }>(`${DELV}/v4/orders-pagination?${qs}`);
      const batch = data?.orders ?? [];
      out.push(...batch);
      token = data?.nextSearchToken ?? '';
      if (batch.length === 0 || !token || token === '|') break;
    }
    return out;
  }

  /** History screen over a date range (Vietnam time, `YYYY-MM-DD`) — auto-splits into ≤ 30-day windows + paginates. */
  async listStatements(
    fromYmd: string,
    toYmd: string,
    opts: { pageSize?: number; maxPages?: number } = {},
  ): Promise<GrabStatement[]> {
    const all: GrabStatement[] = [];
    for (const [from, to] of windows(fromYmd, toYmd)) {
      for (let pageIndex = 0; pageIndex < (opts.maxPages ?? MAX_PAGES); pageIndex++) {
        const qs = new URLSearchParams({
          states: '',
          startTime: vnStart(from),
          endTime: vnEnd(to),
          pageIndex: String(pageIndex),
          pageSize: String(opts.pageSize ?? PAGE_SIZE),
        });
        const data = await this.call<{ statements?: GrabStatement[]; hasMore?: boolean }>(
          `${DELV}/v1/reports/daily-pagination?${qs}`,
        );
        all.push(...(data?.statements ?? []));
        if (!data?.hasMore) break;
        await sleep(200);
      }
    }
    return all;
  }

  /** Order detail — raw body (items, options, `fare`, `eater.comment`…). */
  getOrder(orderId: string): Promise<unknown> {
    return this.call(`${FOOD}/v3/orders/${encodeURIComponent(orderId)}`);
  }

  /**
   * Details for many orders, with bounded concurrency. One failed order doesn't fail the batch (its row gets
   * `detail: null`), EXCEPT an expired session — thrown immediately so the caller can log in again.
   */
  async getOrders(ids: string[]): Promise<GrabOrderBundle[]> {
    const out: GrabOrderBundle[] = [];
    let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try {
          out.push({ statement: { ID: id }, detail: await this.getOrder(id), error: null });
        } catch (e) {
          if (e instanceof GrabError && e.code === 'SESSION_EXPIRED') throw e;
          out.push({ statement: { ID: id }, detail: null, error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, ids.length) }, worker));
    return out;
  }

  // ───────────── Menu + inventory ─────────────

  /** Full menu: `categories[].items[]`, `modifierGroups[]`. */
  getMenu<T = unknown>(): Promise<T | null> {
    return this.call<T>(`${FOOD}/v2/menu`);
  }

  /**
   * Toggle items: 1 available · 2 sold out until next restock · 3 discontinued.
   * ⚠️ Grab does NOT disable items when stock hits 0 (they stay "available") — you must call this.
   */
  async setItemsAvailable(itemIDs: string[], availableStatus: 1 | 2 | 3): Promise<void> {
    if (itemIDs.length === 0) return;
    await this.call(`${FOOD}/v1/items/available-status`, { method: 'PUT', body: { itemIDs, availableStatus } });
  }

  /** Toggle modifiers — Grab has no stock count for modifiers, only available (1) / sold out (2). */
  async setModifiersAvailable(modifierIDs: string[], availableStatus: 1 | 2): Promise<void> {
    if (modifierIDs.length === 0) return;
    await this.call(`${FOOD}/v2/modifiers/available`, { method: 'PUT', body: { availableStatus, modifierIDs } });
  }

  /**
   * Mark orders like the portal buttons: `markStatus` 1 = food ready (notifies the driver) · 2 = seen / new order
   * acknowledged (enum `order-manager/constants/mark.ts`, bundle 8024). Body `{orderIDs, markStatus}` — `{orderID}`
   * returns 400; unknown order ids still get 204 (ignored). Food ready needs `preparationTaskIDs` (from
   * `listActiveOrders`) — without them Grab still returns 204 but the order does NOT change state.
   */
  async markOrders(orderIDs: string[], markStatus: 1 | 2, preparationTaskIDs: string[] = []): Promise<void> {
    if (orderIDs.length === 0) return;
    const body = preparationTaskIDs.length ? { orderIDs, markStatus, preparationTaskIDs } : { orderIDs, markStatus };
    await this.call(`${FOOD}/orders/mark`, { method: 'POST', body });
  }

  /** Current inventory export (CSV with 3 header rows) — patch the numbers and resubmit via `uploadInventoryCsv`. */
  async exportInventoryCsv(): Promise<string> {
    type Cat = { categoryID?: string; id?: string };
    const cats = await this.call<Cat[] | { categories?: Cat[] }>(`${DELV}/v1/inventory/categories?categoryName=&menuGroupID=`);
    const list = Array.isArray(cats) ? cats : (cats?.categories ?? []);
    const categoryIDs = list.map((c) => c.categoryID ?? c.id).filter(Boolean);
    const exp = await this.call<{ downloadUrl?: string }>(`${DELV}/v1/inventory/categories/export`, {
      method: 'POST',
      body: { categoryIDs, menuGroupID: '', itemStatus: '' },
    });
    if (!exp?.downloadUrl) throw new GrabError('BAD_RESPONSE', 'Grab did not return an inventory download link.');
    // Presigned URL → fetch it BARE, without auth headers (S3 rejects them).
    const res = await fetch(exp.downloadUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new GrabError('HTTP_ERROR', `Grab inventory download failed: HTTP ${res.status}`, res.status);
    return res.text();
  }

  /**
   * Bulk inventory import — three steps in the same order as the portal. Returns `taskID` to look up in the portal.
   * Retrying `POST /v1/bulktasks` is safe: the task only takes effect after `complete-uploading`.
   */
  async uploadInventoryCsv(csv: string, fileName: string): Promise<string> {
    // ⚠️ `uploadType` must match the portal's CamelCase exactly — otherwise Grab accepts the task but applies nothing.
    const task = await this.call<{ presignedURL?: string; taskID?: string; headers?: { name?: string; value?: string }[] }>(
      `${DELV}/v1/bulktasks`,
      {
        method: 'POST',
        body: { fileName, uploadType: 'UpdateItemStock', merchantGroupID: this.header('merchantGroupID'), menuGroupID: '' },
      },
    );
    const { presignedURL, taskID } = task ?? {};
    if (!presignedURL || !taskID) throw new GrabError('BAD_RESPONSE', 'Grab did not provide an upload location.');
    const putHeaders: Record<string, string> = {};
    for (const h of task?.headers ?? []) if (h?.name) putHeaders[h.name] = h.value ?? '';
    const put = await fetch(presignedURL, { method: 'PUT', body: csv, headers: putHeaders, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!put.ok) throw new GrabError('HTTP_ERROR', `Grab file upload failed: HTTP ${put.status}`, put.status);
    await this.call(`${DELV}/v1/bulktasks/${encodeURIComponent(taskID)}/complete-uploading`, {
      method: 'PUT',
      body: { taskID, uploadType: 'UpdateItemStock', menuGroupID: '' },
    });
    return taskID;
  }

  // ───────────── HTTP ─────────────

  /** Session header by name, case-insensitive. */
  private header(name: string): string {
    const k = Object.keys(this.session.headers ?? {}).find((h) => h.toLowerCase() === name.toLowerCase());
    return k ? (this.session.headers?.[k] ?? '') : '';
  }

  /** Call `api.grab.com` with the session credentials, retrying on 5xx / network errors. */
  async call<T>(url: string, init: GrabCallInit = {}): Promise<T | null> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = {
      ...(this.session.headers ?? {}),
      merchantID: this.session.merchantId,
      Accept: 'application/json',
      Cookie: this.session.cookie,
    };
    if (this.session.userAgent) headers['User-Agent'] = this.session.userAgent;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const csrf = cookieValue(this.session.cookie, CSRF_COOKIE);
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);

    for (let attempt = 0; ; attempt++) {
      // Timing: a 504 after a few seconds = Grab's circuit breaker; near 30s = their backend actually hung.
      const t0 = Date.now();
      try {
        return await this.fetchOnce<T>(url, method, body, headers);
      } catch (e) {
        const path = new URL(url).pathname;
        if (attempt >= this.retryDelays.length || !worthRetry(e)) throw e;
        this.options.logger?.(
          'warn',
          `Grab ${path} failed after ${Date.now() - t0}ms (${e instanceof Error ? e.message : String(e)}) — retry attempt ${attempt + 2}`,
        );
        await sleep(this.retryDelays[attempt]);
      }
    }
  }

  private async fetchOnce<T>(url: string, method: string, body: string | undefined, headers: Record<string, string>): Promise<T | null> {
    const path = new URL(url).pathname;
    let res: Response;
    try {
      res = await fetch(url, { method, body, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new GrabError('NETWORK', `Could not reach Grab ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 401) throw new GrabError('SESSION_EXPIRED', `Grab returned HTTP 401 for ${method} ${path}`, 401);
    if (res.status === 403) throw new GrabError('FORBIDDEN', `Grab returned HTTP 403 for ${method} ${path}`, 403);
    if (!res.ok) throw new GrabError('HTTP_ERROR', `Grab returned HTTP ${res.status} for ${path}`, res.status);
    if (res.status === 204) return null;
    const text = await res.text();
    try {
      return text ? (JSON.parse(text) as T) : null;
    } catch {
      return null;
    }
  }
}

/** Split [from, to] (plain dates) into windows of ≤ 30 days. */
function windows(fromYmd: string, toYmd: string): [string, string][] {
  const day = 86_400_000;
  const end = Date.parse(`${toYmd}T00:00:00Z`);
  let cur = Date.parse(`${fromYmd}T00:00:00Z`);
  if (!Number.isFinite(cur) || !Number.isFinite(end) || cur > end) {
    throw new GrabError('BAD_RESPONSE', `Invalid date range: ${fromYmd} → ${toYmd}`);
  }
  const out: [string, string][] = [];
  while (cur <= end) {
    const stop = Math.min(end, cur + (MAX_RANGE_DAYS - 1) * day);
    // Plain dates parsed at 00:00 UTC and printed back — independent of the machine's timezone.
    out.push([new Date(cur).toISOString().slice(0, 10), new Date(stop).toISOString().slice(0, 10)]);
    cur = stop + day;
  }
  return out;
}
