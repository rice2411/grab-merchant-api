import { MENU_CSV_TEMPLATE_VI } from './menu-csv-template';

/**
 * Build the CSV of the GrabFood portal's bulk menu import ("Menu › Import"). The upload is a zip: this CSV plus an
 * `images/` folder — the CSV names photo FILES, Grab does not accept URLs.
 *
 * Option groups are serialised as `Name##Min-Max##Option1:Price#Option2:Price`, so `#` and `:` inside names are
 * replaced with `-`. The template has `OptionGroup1..2`; more groups add `OptionGroup3`, `OptionGroup4`… columns.
 */

export type MenuAvailableStatus = 'AVAILABLE' | 'UNAVAILABLE_TODAY' | 'UNAVAILABLE_PERMANENTLY';

/** One option of a group — `price` is the surcharge in VND (0 = free). */
export interface MenuCsvOption {
  name: string;
  price: number;
}

export interface MenuCsvOptionGroup {
  name: string;
  minSelection: number;
  maxSelection: number;
  options: MenuCsvOption[];
}

/** One item row. Texts longer than Grab's limits are cut; rows without `itemName` are dropped. */
export interface MenuCsvRow {
  categoryName: string;
  itemName: string;
  /** VND. */
  price: number;
  availableStatus: MenuAvailableStatus;
  /** Name of an existing selling schedule; empty = always available. */
  availabilitySchedule?: string;
  description?: string;
  /** Photo file names inside `images/` (.png / .jpg), at most `MENU_CSV_LIMITS.photos`. */
  photos?: string[];
  optionGroups?: MenuCsvOptionGroup[];
}

export interface BuildMenuCsvOptions {
  /** Template whose first two records are kept verbatim — default: the Vietnamese portal template. */
  template?: string;
}

/** Limits stated by the template. */
export const MENU_CSV_LIMITS = {
  category: 60,
  item: 80,
  description: 300,
  photos: 4,
  /** Per photo file. */
  photoBytes: 2_000_000,
} as const;

const BOM = '\uFEFF';
/** The template ships with two option group columns. */
const TEMPLATE_GROUPS = 2;

/** Collapse line breaks and cut to Grab's limit. */
const clip = (s: string | undefined, max: number): string =>
  (s || '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
    .slice(0, max);

const safeOptionText = (s: string): string => (s || '').replace(/[#:]/g, '-').trim();

const csvCell = (v: string | number): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** `Name##Min-Max##Option1:Price#Option2:Price`. */
export const serializeOptionGroup = (g: MenuCsvOptionGroup): string =>
  [
    safeOptionText(g.name),
    `${g.minSelection}-${g.maxSelection}`,
    g.options.map((o) => `${safeOptionText(o.name)}:${Math.max(0, Math.round(o.price))}`).join('#'),
  ].join('##');

/** The template's first two CSV records (the second spans several lines through quoted line breaks). */
const templateRecords = (raw: string): [string, string] => {
  const text = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '');
  const records: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === '\n' && !quoted) {
      records.push(text.slice(start, i));
      start = i + 1;
    }
  }
  records.push(text.slice(start));
  return [records[0] ?? '', records[1] ?? ''];
};

/**
 * File name usable in the CSV, taken from a photo URL — empty when the extension is not .png / .jpg / .jpeg, so one
 * bad photo does not make Grab reject the whole row.
 */
export const photoFileName = (url?: string): string => {
  if (!url) return '';
  try {
    const name = decodeURIComponent(new URL(url).pathname).split('/').pop() || '';
    return /\.(png|jpe?g)$/i.test(name) ? name : '';
  } catch {
    return '';
  }
};

/** Complete CSV (with BOM): the template's two records, then one line per item in the given order. */
export function buildMenuCsv(rows: MenuCsvRow[], options: BuildMenuCsvOptions = {}): string {
  const items = rows.map((r) => ({ ...r, itemName: clip(r.itemName, MENU_CSV_LIMITS.item) })).filter((r) => r.itemName);
  const groupCount = Math.max(TEMPLATE_GROUPS, ...items.map((r) => r.optionGroups?.length ?? 0));
  const [headerLine, hintLine] = templateRecords(options.template ?? MENU_CSV_TEMPLATE_VI);

  const extra = groupCount - TEMPLATE_GROUPS;
  const header =
    headerLine + Array.from({ length: extra }, (_, i) => `,OptionGroup${i + TEMPLATE_GROUPS + 1}`).join('');
  const hint = hintLine + ','.repeat(extra);

  const lines = items.map((r) =>
    [
      clip(r.categoryName, MENU_CSV_LIMITS.category),
      r.itemName,
      Math.max(0, Math.round(r.price)),
      r.availableStatus,
      r.availabilitySchedule ?? '',
      clip(r.description, MENU_CSV_LIMITS.description),
      ...Array.from({ length: MENU_CSV_LIMITS.photos }, (_, i) => r.photos?.[i] ?? ''),
      ...Array.from({ length: groupCount }, (_, i) => {
        const g = r.optionGroups?.[i];
        return g ? serializeOptionGroup(g) : '';
      }),
    ]
      .map(csvCell)
      .join(','),
  );

  return `${BOM}${[header, hint, ...lines].join('\n')}\n`;
}
