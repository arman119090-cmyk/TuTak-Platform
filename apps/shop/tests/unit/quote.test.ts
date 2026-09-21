import { describe, expect, it } from 'vitest';
import { computeQuote } from '@/lib/pricing/quote';
import type { PricedProduct, PricedPromo } from '@/lib/pricing/types';
import { FREE_DELIVERY_THRESHOLD_MINOR, SERVICES } from '@/config/site';

const product = (overrides: Partial<PricedProduct> = {}): PricedProduct => ({
  id: 'p1',
  sku: 'SF-STR-0001',
  slug: 'sofa-1',
  name: 'Диван прямой',
  imageUrl: '/media/art/sofa--grey--0--1.svg',
  currency: 'AMD',
  priceMinor: 200_000,
  oldPriceMinor: null,
  stockStatus: 'IN_STOCK',
  stockQty: 10,
  categorySlug: 'straight-sofas',
  rootCategorySlug: 'sofas',
  options: [
    { kind: 'COLOR', valueKey: 'grey', label: null, priceDeltaMinor: 0 },
    { kind: 'COLOR', valueKey: 'emerald', label: null, priceDeltaMinor: 15_000 },
    { kind: 'MATERIAL', valueKey: 'velour', label: null, priceDeltaMinor: 25_000 },
  ],
  ...overrides,
});

const promo = (overrides: Partial<PricedPromo> = {}): PricedPromo => ({
  id: 'promo1',
  code: 'DEMO25',
  discountType: 'PERCENT',
  value: 25,
  minSubtotalMinor: null,
  maxDiscountMinor: null,
  freeDelivery: false,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usedCount: 0,
  isActive: true,
  ...overrides,
});

describe('computeQuote', () => {
  it('multiplies unit price by quantity', () => {
    const quote = computeQuote({ items: [{ productId: 'p1', quantity: 3 }] }, [product()], null);
    expect(quote.subtotalMinor).toBe(600_000);
    expect(quote.itemCount).toBe(3);
  });

  it('adds option price deltas to the unit price', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 2, options: { COLOR: 'emerald', MATERIAL: 'velour' } }] },
      [product()],
      null,
    );
    expect(quote.lines[0]!.unitPriceMinor).toBe(240_000);
    expect(quote.subtotalMinor).toBe(480_000);
  });

  it('ignores option keys the product does not have and records a warning', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 1, options: { COLOR: 'gold' } }] },
      [product()],
      null,
    );
    expect(quote.lines[0]!.unitPriceMinor).toBe(200_000);
    expect(quote.warnings.some((warning) => warning.startsWith('unknown_option'))).toBe(true);
  });

  it('drops out-of-stock products instead of selling them', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 1 }] },
      [product({ stockStatus: 'OUT_OF_STOCK' })],
      null,
    );
    expect(quote.lines).toHaveLength(0);
    expect(quote.warnings).toContain('out_of_stock:SF-STR-0001');
  });

  it('clamps the quantity to the stock on hand', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 9 }] },
      [product({ stockQty: 4 })],
      null,
    );
    expect(quote.lines[0]!.quantity).toBe(4);
    expect(quote.warnings).toContain('quantity_clamped:SF-STR-0001');
  });

  it('skips products that are not in the catalogue', () => {
    const quote = computeQuote({ items: [{ productId: 'ghost', quantity: 1 }] }, [product()], null);
    expect(quote.lines).toHaveLength(0);
    expect(quote.totalMinor).toBe(0);
  });

  it('applies a percentage promo to the subtotal', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 1 }], promoCode: 'DEMO25' },
      [product()],
      promo(),
    );
    expect(quote.promoDiscountMinor).toBe(50_000);
    expect(quote.promoCode).toBe('DEMO25');
  });

  it('caps a promo at its maximum discount', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 5 }], promoCode: 'DEMO25' },
      [product()],
      promo({ maxDiscountMinor: 120_000 }),
    );
    expect(quote.promoDiscountMinor).toBe(120_000);
  });

  it('rejects a promo below its minimum subtotal and reports why', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 1 }], promoCode: 'DEMO25' },
      [product()],
      promo({ minSubtotalMinor: 500_000 }),
    );
    expect(quote.promoDiscountMinor).toBe(0);
    expect(quote.promoRejection).toBe('MIN_SUBTOTAL');
    expect(quote.promoMinSubtotalMinor).toBe(500_000);
  });

  it('rejects an expired promo', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 1 }], promoCode: 'DEMO25' },
      [product()],
      promo({ endsAt: new Date(Date.now() - 1000) }),
    );
    expect(quote.promoRejection).toBe('EXPIRED');
  });

  it('never lets a promo push the total below zero', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 1 }], promoCode: 'BIG' },
      [product()],
      promo({ discountType: 'FIXED', value: 10_000_000 }),
    );
    expect(quote.promoDiscountMinor).toBe(200_000);
    expect(quote.totalMinor).toBe(0);
  });

  it('charges the regional delivery tariff below the free threshold', () => {
    const quote = computeQuote(
      {
        items: [{ productId: 'p1', quantity: 1 }],
        delivery: { method: 'DELIVERY', regionKey: 'shirak' },
      },
      [product()],
      null,
    );
    expect(quote.deliveryMinor).toBe(16_000);
    expect(quote.deliveryIsFree).toBe(false);
  });

  it('ships free at or above the free-delivery threshold', () => {
    const quote = computeQuote(
      {
        items: [{ productId: 'p1', quantity: 3 }],
        delivery: { method: 'DELIVERY', regionKey: 'syunik' },
      },
      [product({ priceMinor: FREE_DELIVERY_THRESHOLD_MINOR })],
      null,
    );
    expect(quote.deliveryIsFree).toBe(true);
    expect(quote.deliveryMinor).toBe(0);
  });

  it('never charges delivery for pickup', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 1 }], delivery: { method: 'PICKUP' } },
      [product()],
      null,
    );
    expect(quote.deliveryMinor).toBe(0);
  });

  it('charges assembly per unit and lift per floor without a lift', () => {
    const quote = computeQuote(
      {
        items: [{ productId: 'p1', quantity: 2 }],
        delivery: { method: 'DELIVERY', regionKey: 'yerevan', floor: 4, hasLift: false },
        services: { assembly: true, lift: true },
      },
      [product()],
      null,
    );
    const assembly = SERVICES.assembly.priceMinor * 2;
    const lift = SERVICES.lift.priceMinor + 3 * 1_000;
    expect(quote.servicesMinor).toBe(assembly + lift);
  });

  it('adds up to a total of subtotal − promo + delivery + services', () => {
    const quote = computeQuote(
      {
        items: [{ productId: 'p1', quantity: 1 }],
        promoCode: 'DEMO25',
        delivery: { method: 'DELIVERY', regionKey: 'yerevan' },
        services: { assembly: true },
      },
      [product()],
      promo(),
    );
    expect(quote.totalMinor).toBe(
      quote.subtotalMinor - quote.promoDiscountMinor + quote.deliveryMinor + quote.servicesMinor,
    );
  });

  it('reports the saving against the crossed-out price', () => {
    const quote = computeQuote(
      { items: [{ productId: 'p1', quantity: 2 }] },
      [product({ oldPriceMinor: 260_000 })],
      null,
    );
    expect(quote.itemsDiscountMinor).toBe(120_000);
  });

  it('keeps every amount an integer', () => {
    const quote = computeQuote(
      {
        items: [{ productId: 'p1', quantity: 3, options: { COLOR: 'emerald' } }],
        promoCode: 'DEMO25',
        delivery: { method: 'DELIVERY', regionKey: 'lori', floor: 7, hasLift: false },
        services: { assembly: true, lift: true },
      },
      [product({ priceMinor: 199_999 })],
      promo({ value: 13 }),
    );
    for (const amount of [
      quote.subtotalMinor,
      quote.promoDiscountMinor,
      quote.deliveryMinor,
      quote.servicesMinor,
      quote.totalMinor,
    ]) {
      expect(Number.isInteger(amount)).toBe(true);
    }
  });
});
