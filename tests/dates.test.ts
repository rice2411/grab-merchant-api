import { describe, expect, it } from 'vitest';
import { dateWindows, vnEnd, vnStart } from '../src/client/dates';
import { GrabError } from '../src/errors';

describe('dateWindows', () => {
  it('returns a single window for one day', () => {
    expect(dateWindows('2026-01-05', '2026-01-05')).toEqual([['2026-01-05', '2026-01-05']]);
  });

  it('keeps a 30-day range in one window', () => {
    expect(dateWindows('2026-01-01', '2026-01-30')).toEqual([['2026-01-01', '2026-01-30']]);
  });

  it('splits longer ranges into contiguous windows of at most 30 days', () => {
    expect(dateWindows('2026-01-01', '2026-03-15')).toEqual([
      ['2026-01-01', '2026-01-30'],
      ['2026-01-31', '2026-03-01'],
      ['2026-03-02', '2026-03-15'],
    ]);
  });

  it('handles leap days and year boundaries', () => {
    expect(dateWindows('2027-12-20', '2028-03-01')).toEqual([
      ['2027-12-20', '2028-01-18'],
      ['2028-01-19', '2028-02-17'],
      ['2028-02-18', '2028-03-01'],
    ]);
  });

  it('rejects reversed or invalid ranges with BAD_RESPONSE', () => {
    for (const [from, to] of [
      ['2026-02-01', '2026-01-01'],
      ['nope', '2026-01-01'],
    ]) {
      const err = (() => {
        try {
          dateWindows(from, to);
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(GrabError);
      expect((err as GrabError).code).toBe('BAD_RESPONSE');
    }
  });
});

describe('Vietnam day bounds', () => {
  it('formats start/end of day at UTC+7', () => {
    expect(vnStart('2026-01-05')).toBe('2026-01-05T00:00:00+07:00');
    expect(vnEnd('2026-01-05')).toBe('2026-01-05T23:59:59+07:00');
  });
});
