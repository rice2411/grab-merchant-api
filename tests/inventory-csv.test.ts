import { describe, expect, it } from 'vitest';
import { GrabError } from '../src/errors';
import { patchInventoryCsv, readInventoryCsv } from '../src/inventory-csv';

// Same shape as a real export: a title row, the human header (with spaces), then the machine header.
const CSV = [
  'Inventory export',
  'Item ID,Item Name,Current Stock,Max Stock,Item Status',
  'ITEMID,ITEMNAME,CURRENTSTOCK,MAXSTOCK,ITEMSTATUS',
  'A1,"Cookie, chocolate",5,10,AVAILABLE',
  'B2,Brownie,,,AVAILABLE',
  'C3,"Say ""hi""",0,20,UNAVAILABLE',
  '',
].join('\n');

describe('readInventoryCsv', () => {
  it('reads stock per item (header row matched ignoring case and spaces)', () => {
    const m = readInventoryCsv(CSV);
    expect(m.get('A1')).toEqual({ stock: 5, max: 10 });
    expect(m.get('B2')).toEqual({ stock: null, max: null });
    expect(m.get('C3')).toEqual({ stock: 0, max: 20 });
  });

  it('throws CSV_SHAPE when the layout is unknown', () => {
    expect(() => readInventoryCsv('a,b\n1,2')).toThrow(GrabError);
    try {
      readInventoryCsv('ITEMID,NAME\nA1,x');
    } catch (e) {
      expect((e as GrabError).code).toBe('CSV_SHAPE');
    }
  });
});

describe('patchInventoryCsv', () => {
  it('rewrites only rows whose numbers change, keeping quoting intact', () => {
    const { csv, changed } = patchInventoryCsv(CSV, [
      { itemID: 'A1', qty: 3, maxQty: null },
      { itemID: 'C3', qty: 0, maxQty: 20 },
      { itemID: 'ZZ', qty: 9 },
    ]);
    expect(changed).toBe(1);
    const lines = csv.split('\n');
    expect(lines[3]).toBe('A1,"Cookie, chocolate",3,10,AVAILABLE');
    expect(lines[5]).toBe('C3,"Say ""hi""",0,20,UNAVAILABLE');
    expect(readInventoryCsv(csv).get('A1')).toEqual({ stock: 3, max: 10 });
  });

  it('sets MAXSTOCK when given and skips rows with no quantity', () => {
    const { csv, changed } = patchInventoryCsv(CSV, [
      { itemID: 'B2', qty: 7, maxQty: 7 },
      { itemID: 'A1', qty: null },
    ]);
    expect(changed).toBe(1);
    expect(readInventoryCsv(csv).get('B2')).toEqual({ stock: 7, max: 7 });
    expect(readInventoryCsv(csv).get('A1')).toEqual({ stock: 5, max: 10 });
  });
});
