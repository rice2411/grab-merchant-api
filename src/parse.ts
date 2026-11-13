/**
 * Typed views over the raw portal bodies that `GrabClient` returns untouched (`getOrders()[].detail`, `getMenu()`).
 * Missing or malformed fields become empty strings / 0 / [] — these never throw.
 *
 * Money traps in order detail:
 * - Amounts are display strings like `"292.000"` (dot = thousands separator, VND has no minor unit) — `parseMoney`.
 * - `fare.totalDisplay` is what the order is worth to the store before Grab's fees; the store's net is
 *   `total − commission − vat − pit`. `statement.orderEarningsInMinorUnit` is NOT the net either, it equals the total.
 * - An item's `originalItemPriceDisplay` is already multiplied by the quantity; the unit price is `fare.priceInMin`.
 * - `fare.totalDiscountAmountDisplay` is the store-funded part of the promotion and is already taken off `total`;
 *   the rest of `promotionDisplay` is funded by Grab.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Number or numeric string → number; anything else → 0. */
const num = (v: unknown): number => {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** `"292.000"` → 292000; numbers pass through; anything else → 0. */
export const parseMoney = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const n = Number(v.replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export interface GrabOrderModifier {
  groupName: string;
  name: string;
}

export interface GrabOrderItem {
  itemId: string;
  name: string;
  quantity: number;
  /** Unit price, VND. */
  unitPrice: number;
  comment: string;
  modifiers: GrabOrderModifier[];
}

/** Order amounts, VND. */
export interface GrabOrderFare {
  /** Item prices before promotions. */
  subtotal: number;
  /** Order value for the store, store-funded discount already deducted. */
  total: number;
  commission: number;
  vat: number;
  /** Personal income tax withheld by Grab. */
  pit: number;
  /** `total − commission − vat − pit`. */
  net: number;
  /** Whole promotion the customer got (store + Grab funded). */
  promotion: number;
  /** Store-funded part of `promotion`. */
  shopDiscount: number;
  /** What the customer paid. */
  customerPaid: number;
}

export interface GrabOrder {
  id: string;
  /** Short code shown in the portal, e.g. `GF-173`. */
  displayId: string;
  bookingCode: string;
  /** Raw state, e.g. `COMPLETED`, `CANCELLED`. */
  state: string;
  /** ISO time, `null` when missing. */
  createdAt: string | null;
  scheduled: boolean;
  takeaway: boolean;
  /** Raw payment method, e.g. `Cash`, `Cashless`. */
  paymentMethod: string;
  /** Grab masks the customer's name (`***`). */
  eaterName: string;
  eaterComment: string;
  fare: GrabOrderFare;
  items: GrabOrderItem[];
}

const parseItem = (raw: unknown): GrabOrderItem | null => {
  const it = obj(raw);
  const itemId = text(it.itemID);
  if (!itemId) return null;
  const modifiers: GrabOrderModifier[] = [];
  for (const g of arr(it.modifierGroups).map(obj)) {
    const groupName = text(g.modifierGroupName);
    for (const m of arr(g.modifiers).map(obj)) {
      const name = text(m.modifierName);
      if (name) modifiers.push({ groupName, name });
    }
  }
  const fare = obj(it.fare);
  return {
    itemId,
    name: text(it.name),
    quantity: num(it.quantity) || 1,
    unitPrice: num(fare.priceInMin) || parseMoney(fare.priceDisplay),
    comment: text(it.comment),
    modifiers,
  };
};

/** Raw body of an order detail (`getOrders()[].detail`) → `GrabOrder`; `null` when it carries no order id. */
export function parseOrder(detail: unknown): GrabOrder | null {
  const o = obj(obj(detail).order);
  const id = text(o.orderID);
  if (!id) return null;
  const fare = obj(o.fare);
  const total = parseMoney(fare.totalDisplay);
  const commission = parseMoney(fare.mexCommissionDisplay);
  const vat = parseMoney(fare.mexVatAmountDisplay);
  const pit = parseMoney(fare.mexPitAmountDisplay);
  return {
    id,
    displayId: text(o.displayID),
    bookingCode: text(o.bookingCode),
    state: text(o.state),
    createdAt: text(obj(o.times).createdAt) || null,
    scheduled: o.scheduledOrderInfo != null,
    takeaway: o.isTakeawayOrder === true,
    paymentMethod: text(o.paymentMethod),
    eaterName: text(obj(o.eater).name),
    eaterComment: text(obj(o.eater).comment),
    fare: {
      subtotal: parseMoney(fare.subTotalDisplay),
      total,
      commission,
      vat,
      pit,
      net: total - commission - vat - pit,
      promotion: parseMoney(fare.promotionDisplay),
      shopDiscount: parseMoney(fare.totalDiscountAmountDisplay),
      customerPaid: parseMoney(fare.passengerTotalDisplay),
    },
    items: arr(obj(o.itemInfo).items)
      .map(parseItem)
      .filter((x): x is GrabOrderItem => x !== null),
  };
}

/** `availableStatus` on the menu: items / categories 1 available · 2 out until the next restock · 3 unavailable; modifiers 1 · 2. */
export interface GrabMenuItem {
  id: string;
  name: string;
  /** VND. */
  price: number;
  availableStatus: number;
  imageUrl: string;
  modifierGroupIds: string[];
}

export interface GrabMenuCategory {
  id: string;
  name: string;
  availableStatus: number;
  items: GrabMenuItem[];
}

export interface GrabMenuModifier {
  id: string;
  name: string;
  /** Surcharge, VND. */
  price: number;
  availableStatus: number;
}

export interface GrabMenuModifierGroup {
  id: string;
  name: string;
  itemIds: string[];
  modifiers: GrabMenuModifier[];
}

export interface GrabMenuData {
  categories: GrabMenuCategory[];
  modifierGroups: GrabMenuModifierGroup[];
}

const ids = (v: unknown): string[] => arr(v).map(String).filter(Boolean);

/** Raw body of `getMenu()` → `GrabMenuData`. */
export function parseMenu(menu: unknown): GrabMenuData {
  const m = obj(menu);
  return {
    categories: arr(m.categories)
      .map(obj)
      .map((c) => ({
        id: text(c.categoryID),
        name: text(c.categoryName),
        availableStatus: num(c.availableStatus),
        items: arr(c.items)
          .map(obj)
          .map((it) => ({
            id: text(it.itemID),
            name: text(it.itemName),
            price: num(it.priceInMin) || parseMoney(it.priceDisplay),
            availableStatus: num(it.availableStatus),
            imageUrl: text(it.imageURL),
            modifierGroupIds: ids(it.linkedModifierGroupIDs),
          })),
      })),
    modifierGroups: arr(m.modifierGroups)
      .map(obj)
      .map((g) => ({
        id: text(g.modifierGroupID),
        name: text(g.modifierGroupName),
        itemIds: ids(g.relatedItemIDs),
        modifiers: arr(g.modifiers)
          .map(obj)
          .map((x) => ({
            id: text(x.modifierID),
            name: text(x.modifierName),
            price: num(x.priceInMin) || parseMoney(x.priceDisplay),
            availableStatus: num(x.availableStatus),
          })),
      })),
  };
}
