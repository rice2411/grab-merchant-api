/** Portal's general API gateway (order list, reports, inventory, bulk tasks). */
export const DELV = 'https://api.grab.com/delvplatformapi/merchant';
/** Menu + order detail gateway — the ONLY place to toggle individual items / options. */
export const FOOD = 'https://api.grab.com/food/merchant';
export const PORTAL = 'https://merchant.grab.com';
/** Login page — `redirect` returns to the portal, which sets the `mexusers_*` cookies on `.grab.com`. */
export const LOGIN_URL =
  'https://weblogin.grab.com/merchant/login?service_id=MEXUSERS&redirect=https%3A%2F%2Fmerchant.grab.com%2Fportal';

/** Portal access token (JWT, valid for 2 days). Expired means 401 — the portal has no refresh path. */
export const TOKEN_COOKIE = 'mexusers_authn_token';
/**
 * Double-submit CSRF protection: write requests must send the `X-CSRF-Token` header
 * set to this cookie's value. Missing it yields 403 even with a live session.
 */
export const CSRF_COOKIE = 'mexusers_authn_token_jti';

/** Grab merchant id: `5-XXXXXXXXXXXX`. */
export const MERCHANT_RE = /^[0-9]+-[A-Z0-9]{8,}$/;

/**
 * Headers the portal attaches to every `api.grab.com` request (captured via CDP during login). They
 * carry no secrets — Grab identifies the merchant by cookie — but some gateways return 400 without them.
 */
export const PORTAL_HEADER_NAMES = ['requestsource', 'x-grabkit-clientid', 'x-client-id', 'accept-language'];

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

/** Grab returns large files; 30s is plenty for the heaviest step (downloading the inventory export). */
export const TIMEOUT_MS = 30_000;

/** Tabs of the Orders screen — the `PageType` param of `v4/orders-pagination` (bundle `gf/js/8024…`). */
export const PageType = {
  PREPARING: 'Preparing',
  PREPARING_V2: 'PreparingV2',
  READY: 'Ready',
  UPCOMING: 'Upcoming',
  DELIVERING: 'Delivering',
  COMPLETED: 'Completed',
} as const;
export type PageType = (typeof PageType)[keyof typeof PageType];
