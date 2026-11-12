/** Credentials for one Grab portal session — returned by `loginGrab`; PERSIST it to call the API until it expires. */
export interface GrabSession {
  /** Merchant id (`5-XXXXXXXXXXXX`) — the `merchantID` header of every request. */
  merchantId: string;
  /** `.grab.com` cookies as `a=1; b=2` — the real credentials (`mexusers_authn_token`, `grabid-openid-authn-ck`…). */
  cookie: string;
  /** Portal headers (`requestSource`, `x-client-id`…) — not secret, but some gateways require them. */
  headers?: Record<string, string>;
  userAgent?: string;
}

/** Login with the portal username (the "Username" tab of weblogin). */
export interface GrabCredentials {
  username: string;
  password: string;
}

/** One row of the History screen (`v1/reports/daily-pagination`) — source for re-syncing. */
export interface GrabStatement {
  ID: string;
  displayID?: string;
  deliveryStatus?: string;
  [k: string]: unknown;
}

/** One order on the Orders screen (`v4/orders-pagination`) — the ONLY place new orders show up immediately. */
export interface GrabActiveOrder {
  orderID: string;
  state?: string;
  orderState?: string;
  displayID?: string;
  /** Food preparation task id (`<orderID>-PREP-…`) — required by "Food ready"; ONLY this list has it, order detail returns empty. */
  preparationTaskID?: string;
  /** `ACCEPTED` = order has been accepted (immediately, if the store has auto-accept on). */
  preparationTaskpoolStatus?: string;
  [k: string]: unknown;
}

/** Summary + detail pair — the shape of one entry in an orders export. */
export interface GrabOrderBundle {
  statement: { ID: string; [k: string]: unknown };
  /** Raw body of `food/merchant/v3/orders/{id}` — the app extracts fields itself. `null` when fetching failed. */
  detail: unknown;
  error: string | null;
}

export interface GrabCallInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Object → JSON. */
  body?: unknown;
}

export interface GrabClientOptions {
  logger?: (level: 'debug' | 'warn', msg: string) => void;
  /** Retry on 5xx / network errors — default `[2000, 5000]` (Grab bulk tasks often hit transient 504s). */
  retryDelaysMs?: number[];
}
