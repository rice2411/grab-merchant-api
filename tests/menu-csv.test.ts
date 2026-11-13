import { describe, expect, it } from 'vitest';
import { MENU_CSV_TEMPLATE_VI, buildMenuCsv, photoFileName, serializeOptionGroup } from '../src';

const TEMPLATE = '*CategoryName,*ItemName,OptionGroup1,OptionGroup2\n"line one\nline two",b,c,\n';

describe('buildMenuCsv', () => {
  it('keeps the two template records and writes one line per item', () => {
    const csv = buildMenuCsv(
      [
        {
          categoryName: 'Cakes',
          itemName: 'Brownie, "fudge"',
          price: 45000.4,
          availableStatus: 'AVAILABLE',
          description: 'two\nlines',
          photos: ['a.jpg'],
          optionGroups: [{ name: 'Size', minSelection: 1, maxSelection: 1, options: [{ name: 'L', price: 5000 }] }],
        },
      ],
      { template: TEMPLATE },
    );
    expect(csv.startsWith('\uFEFF*CategoryName')).toBe(true);
    const lines = csv.slice(1).split('\n');
    expect(lines[0]).toBe('*CategoryName,*ItemName,OptionGroup1,OptionGroup2');
    expect(lines[1]).toBe('"line one');
    expect(lines[2]).toBe('line two",b,c,');
    expect(lines[3]).toBe('Cakes,"Brownie, ""fudge""",45000,AVAILABLE,,two lines,a.jpg,,,,Size##1-1##L:5000,');
    expect(lines[4]).toBe('');
  });

  it('adds OptionGroup columns past the template two and drops rows without a name', () => {
    const g = { name: 'G', minSelection: 0, maxSelection: 1, options: [] };
    const csv = buildMenuCsv(
      [
        { categoryName: 'C', itemName: 'A', price: 1, availableStatus: 'AVAILABLE', optionGroups: [g, g, g] },
        { categoryName: 'C', itemName: '  ', price: 1, availableStatus: 'AVAILABLE' },
      ],
      { template: TEMPLATE },
    );
    const lines = csv.slice(1).trimEnd().split('\n');
    expect(lines[0].endsWith(',OptionGroup3')).toBe(true);
    expect(lines[2].endsWith(',c,,')).toBe(true);
    expect(lines).toHaveLength(4);
  });

  it('uses the bundled Vietnamese template by default', () => {
    const csv = buildMenuCsv([]);
    expect(csv).toContain('*CategoryName,*ItemName,*Price,*AvailableStatus');
    expect(MENU_CSV_TEMPLATE_VI).toContain('OptionGroup2');
  });
});

describe('serializeOptionGroup', () => {
  it('escapes separators and rounds prices', () => {
    expect(
      serializeOptionGroup({
        name: 'Vị#1',
        minSelection: 1,
        maxSelection: 2,
        options: [
          { name: 'a:b', price: 1.6 },
          { name: 'c', price: -3 },
        ],
      }),
    ).toBe('Vị-1##1-2##a-b:2#c:0');
  });
});

describe('photoFileName', () => {
  it('takes the decoded file name of png/jpg URLs only', () => {
    expect(photoFileName('https://x.com/p/B%C3%A1nh.JPG?v=1')).toBe('Bánh.JPG');
    expect(photoFileName('https://x.com/p/a.webp')).toBe('');
    expect(photoFileName('not a url')).toBe('');
    expect(photoFileName()).toBe('');
  });
});
