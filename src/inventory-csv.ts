import { GrabError } from './errors';

/**
 * Helpers for the inventory CSV returned by `exportInventoryCsv()` — read stock per item, or patch the numbers
 * before sending the file back with `uploadInventoryCsv()`.
 *
 * The file has TWO header rows written differently: a human one (`Item ID, Current Stock`, with spaces) and a
 * machine one (`ITEMID, CURRENTSTOCK`). Column names are matched after upper-casing and dropping ALL whitespace,
 * so either row is recognised. Matching verbatim picks the human row, misses `CURRENTSTOCK`, and the uploaded
 * file changes nothing while the bulk task still reports `Succeeded`.
 */

/** New stock for one item. `qty` null / undefined = leave the row alone; `maxQty` null / undefined = keep `MAXSTOCK`. */
export interface InventoryStockPatch {
  itemID: string;
  qty: number | null | undefined;
  maxQty?: number | null;
}

/** Stock of one item as read from the CSV. An empty cell (item without stock tracking) is `null`. */
export interface InventoryStock {
  stock: number | null;
  max: number | null;
}

/** Split one CSV line, honouring double quotes and commas inside cells. */
const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
};

const joinCsvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const norm = (c: string): string => c.trim().toUpperCase().replace(/\s+/g, '');

/** Locate the header row and the item / stock / max-stock columns — throws `CSV_SHAPE` when Grab changed the layout. */
const locateColumns = (lines: string[]): { headIdx: number; cItem: number; cCur: number; cMax: number } => {
  const headIdx = lines.findIndex((l) => splitCsvLine(l).some((c) => norm(c) === 'ITEMID'));
  if (headIdx < 0) throw new GrabError('CSV_SHAPE', 'Inventory CSV has no ITEMID header row.');
  const head = splitCsvLine(lines[headIdx]).map(norm);
  const cItem = head.indexOf('ITEMID');
  const cCur = head.indexOf('CURRENTSTOCK');
  if (cCur < 0) throw new GrabError('CSV_SHAPE', 'Inventory CSV has no CURRENTSTOCK column.');
  return { headIdx, cItem, cCur, cMax: head.indexOf('MAXSTOCK') };
};

/** Stock per item id from an inventory export. */
export function readInventoryCsv(csv: string): Map<string, InventoryStock> {
  const out = new Map<string, InventoryStock>();
  const lines = csv.split('\n');
  const { headIdx, cItem, cCur, cMax } = locateColumns(lines);
  const toNum = (v: string | undefined): number | null => {
    const t = (v ?? '').trim();
    return t === '' || !Number.isFinite(Number(t)) ? null : Number(t);
  };
  for (let i = headIdx + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i]);
    const id = (cells[cItem] ?? '').trim();
    if (id) out.set(id, { stock: toNum(cells[cCur]), max: cMax >= 0 ? toNum(cells[cMax]) : null });
  }
  return out;
}

/**
 * Write new `CURRENTSTOCK` / `MAXSTOCK` values into an inventory export. Returns the patched CSV and how many
 * rows actually changed — skip the upload when `changed` is 0.
 *
 * `ITEMSTATUS` is never touched. Note that Grab does NOT disable an item when its stock reaches 0 — use
 * `setItemsAvailable` for that.
 */
export function patchInventoryCsv(csv: string, rows: InventoryStockPatch[]): { csv: string; changed: number } {
  const byId = new Map(rows.filter((r) => r.itemID).map((r) => [String(r.itemID), r]));
  const lines = csv.split('\n');
  const { headIdx, cItem, cCur, cMax } = locateColumns(lines);

  let changed = 0;
  for (let i = headIdx + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i]);
    const want = byId.get((cells[cItem] ?? '').trim());
    if (!want || want.qty === null || want.qty === undefined) continue;
    const nextCur = String(want.qty);
    const nextMax = want.maxQty === null || want.maxQty === undefined ? cells[cMax] : String(want.maxQty);
    if (cells[cCur] === nextCur && (cMax < 0 || cells[cMax] === nextMax)) continue;
    cells[cCur] = nextCur;
    if (cMax >= 0) cells[cMax] = nextMax;
    lines[i] = cells.map(joinCsvCell).join(',');
    changed += 1;
  }
  return { csv: lines.join('\n'), changed };
}
