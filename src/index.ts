/**
 * grab-merchant-api — unofficial Grab Merchant API (emulates the merchant.grab.com portal).
 *
 * ```ts
 * const session = await loginGrab({ username, password }, { chromePath, onOtp });  // PERSIST the session
 * const grab = new GrabClient(session);
 * const active = await grab.listActiveOrders(PageType.PREPARING);
 * const bundles = await grab.getOrders(active.map((o) => o.orderID));
 * ```
 *
 * A session lives 2 days and cannot be refreshed — `grab.expiresAt()` reports the expiry,
 * `GrabError('SESSION_EXPIRED')` once it has passed. See README.
 */
export { GrabClient, cookieValue, tokenExpiresAt } from './client';
export { PageType } from './constants';
export { GrabError } from './errors';
export type { GrabErrorCode } from './errors';
export { loginGrab } from './login';
export type { GrabLoginEvent, GrabLoginOptions, GrabRemote, GrabRemoteKey, GrabRemoteScreen } from './login';
export type * from './types';
