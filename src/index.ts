/**
 * grab-merchant-api — unofficial Grab Merchant API (emulates the merchant.grab.com portal).
 *
 * ```ts
 * const session = await loginGrab({ username, password }, { onOtp });  // PERSIST the session
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
export { patchInventoryCsv, readInventoryCsv } from './inventory-csv';
export type { InventoryStock, InventoryStockPatch } from './inventory-csv';
export { MENU_CSV_LIMITS, buildMenuCsv, photoFileName, serializeOptionGroup } from './menu-csv';
export type {
  BuildMenuCsvOptions,
  MenuAvailableStatus,
  MenuCsvOption,
  MenuCsvOptionGroup,
  MenuCsvRow,
} from './menu-csv';
export { MENU_CSV_TEMPLATE_VI } from './menu-csv-template';
export { parseMenu, parseMoney, parseOrder } from './parse';
export type {
  GrabMenuCategory,
  GrabMenuData,
  GrabMenuItem,
  GrabMenuModifier,
  GrabMenuModifierGroup,
  GrabOrder,
  GrabOrderFare,
  GrabOrderItem,
  GrabOrderModifier,
} from './parse';
export { loginGrab } from './auth/login';
export { findChromePath } from './auth/chrome';
export type { FindChromeEnv } from './auth/chrome';
export type { GrabLoginEvent, GrabLoginOptions, GrabRemote, GrabRemoteKey, GrabRemoteScreen } from './auth/types';
export type * from './types';
