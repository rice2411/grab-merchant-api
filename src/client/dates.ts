import { GrabError } from '../errors';

/** Grab's max range per report query (longer ranges are split into windows). */
export const MAX_RANGE_DAYS = 30;

/** `YYYY-MM-DD` date → start/end of day in Vietnam time (UTC+7), as Grab's report API expects. */
export const vnStart = (ymd: string) => `${ymd}T00:00:00+07:00`;
export const vnEnd = (ymd: string) => `${ymd}T23:59:59+07:00`;

/** Split [from, to] (plain dates) into windows of ≤ 30 days. */
export function dateWindows(fromYmd: string, toYmd: string): [string, string][] {
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
