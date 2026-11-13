import { describe, expect, it } from 'vitest';
import { parseMenu, parseMoney, parseOrder } from '../src';

describe('parseMoney', () => {
  it('reads display strings and numbers', () => {
    expect(parseMoney('292.000')).toBe(292000);
    expect(parseMoney(1500)).toBe(1500);
    expect(parseMoney(undefined)).toBe(0);
    expect(parseMoney('')).toBe(0);
  });
});

describe('parseOrder', () => {
  it('normalises an order detail', () => {
    const o = parseOrder({
      order: {
        orderID: '123',
        displayID: 'GF-1',
        bookingCode: 'A-1',
        state: 'COMPLETED',
        times: { createdAt: '2026-11-13T01:00:00Z' },
        isTakeawayOrder: true,
        paymentMethod: 'Cash',
        eater: { name: '***', comment: 'no ice' },
        fare: {
          subTotalDisplay: '100.000',
          totalDisplay: '90.000',
          mexCommissionDisplay: '18.000',
          mexVatAmountDisplay: '1.800',
          mexPitAmountDisplay: '900',
          promotionDisplay: '20.000',
          totalDiscountAmountDisplay: '10.000',
          passengerTotalDisplay: '95.000',
        },
        itemInfo: {
          items: [
            {
              itemID: 'i1',
              name: 'Cookie',
              quantity: 2,
              fare: { priceInMin: 25000, priceDisplay: '50.000' },
              modifierGroups: [{ modifierGroupName: 'Size', modifiers: [{ modifierName: 'L' }, {}] }],
            },
            { itemID: 'i2', name: 'Tea', fare: { priceDisplay: '10.000' }, comment: 'hot' },
            { name: 'no id' },
          ],
        },
      },
    });
    expect(o).toMatchObject({
      id: '123',
      displayId: 'GF-1',
      state: 'COMPLETED',
      createdAt: '2026-11-13T01:00:00Z',
      scheduled: false,
      takeaway: true,
      eaterComment: 'no ice',
      fare: {
        subtotal: 100000,
        total: 90000,
        net: 69300,
        promotion: 20000,
        shopDiscount: 10000,
        customerPaid: 95000,
      },
    });
    expect(o?.items).toEqual([
      {
        itemId: 'i1',
        name: 'Cookie',
        quantity: 2,
        unitPrice: 25000,
        comment: '',
        modifiers: [{ groupName: 'Size', name: 'L' }],
      },
      { itemId: 'i2', name: 'Tea', quantity: 1, unitPrice: 10000, comment: 'hot', modifiers: [] },
    ]);
  });

  it('returns null without an order id', () => {
    expect(parseOrder(null)).toBeNull();
    expect(parseOrder({ order: {} })).toBeNull();
  });
});

describe('parseMenu', () => {
  it('normalises categories, items and modifier groups', () => {
    const m = parseMenu({
      categories: [
        {
          categoryID: 'c1',
          categoryName: 'Cakes',
          availableStatus: 1,
          items: [
            {
              itemID: 'i1',
              itemName: 'Brownie',
              priceInMin: 45000,
              availableStatus: '2',
              linkedModifierGroupIDs: ['g1'],
            },
            { itemID: 'i2', itemName: 'Tart', priceDisplay: '30.000' },
          ],
        },
      ],
      modifierGroups: [
        {
          modifierGroupID: 'g1',
          modifierGroupName: 'Size',
          relatedItemIDs: ['i1'],
          modifiers: [{ modifierID: 'm1', modifierName: 'L', priceDisplay: '5.000', availableStatus: 1 }],
        },
      ],
    });
    expect(m.categories[0].items[0]).toEqual({
      id: 'i1',
      name: 'Brownie',
      price: 45000,
      availableStatus: 2,
      imageUrl: '',
      modifierGroupIds: ['g1'],
    });
    expect(m.categories[0].items[1].price).toBe(30000);
    expect(m.modifierGroups[0]).toEqual({
      id: 'g1',
      name: 'Size',
      itemIds: ['i1'],
      modifiers: [{ id: 'm1', name: 'L', price: 5000, availableStatus: 1 }],
    });
    expect(parseMenu(null)).toEqual({ categories: [], modifierGroups: [] });
  });
});
