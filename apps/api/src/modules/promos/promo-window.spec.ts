import { PartnerStatus } from '@prisma/client';
import { isPromoLive, isWindowOrdered, livePromoWhere } from './promo-window';

const NOW = new Date('2026-09-19T12:00:00Z');
const before = new Date('2026-09-19T11:00:00Z');
const after = new Date('2026-09-19T13:00:00Z');

const trading = { isActive: true, status: PartnerStatus.ACTIVE };

function promo(over: Partial<Parameters<typeof isPromoLive>[0]> = {}) {
  return { active: true, startAt: null, endAt: null, partner: trading, ...over };
}

describe('isPromoLive', () => {
  it('shows an active card with no window', () => {
    expect(isPromoLive(promo(), NOW)).toBe(true);
  });

  it('never shows a card the administrator switched off', () => {
    expect(isPromoLive(promo({ active: false }), NOW)).toBe(false);
  });

  it('never shows a card for a partner that is not trading', () => {
    expect(isPromoLive(promo({ partner: { isActive: false, status: PartnerStatus.ACTIVE } }), NOW)).toBe(false);
    expect(isPromoLive(promo({ partner: { isActive: true, status: PartnerStatus.SUSPENDED } }), NOW)).toBe(false);
    expect(isPromoLive(promo({ partner: { isActive: true, status: PartnerStatus.PENDING_APPROVAL } }), NOW)).toBe(false);
  });

  it('waits for startAt', () => {
    expect(isPromoLive(promo({ startAt: after }), NOW)).toBe(false);
    expect(isPromoLive(promo({ startAt: before }), NOW)).toBe(true);
    expect(isPromoLive(promo({ startAt: NOW }), NOW)).toBe(true);
  });

  it('is gone at endAt, exclusive — an expired campaign is never served', () => {
    expect(isPromoLive(promo({ endAt: before }), NOW)).toBe(false);
    expect(isPromoLive(promo({ endAt: NOW }), NOW)).toBe(false);
    expect(isPromoLive(promo({ endAt: after }), NOW)).toBe(true);
  });

  it('applies both ends of the window together', () => {
    expect(isPromoLive(promo({ startAt: before, endAt: after }), NOW)).toBe(true);
    expect(isPromoLive(promo({ startAt: after, endAt: new Date('2026-09-20T00:00:00Z') }), NOW)).toBe(false);
  });
});

describe('livePromoWhere', () => {
  it('is the same rule, expressed for Prisma', () => {
    expect(livePromoWhere(NOW)).toEqual({
      active: true,
      partner: { isActive: true, status: PartnerStatus.ACTIVE },
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: NOW } }] },
        { OR: [{ endAt: null }, { endAt: { gt: NOW } }] },
      ],
    });
  });
});

describe('isWindowOrdered', () => {
  it('accepts an open or half-open window', () => {
    expect(isWindowOrdered(null, null)).toBe(true);
    expect(isWindowOrdered(before, null)).toBe(true);
    expect(isWindowOrdered(null, after)).toBe(true);
  });

  it('refuses a window that ends before, or exactly when, it starts', () => {
    expect(isWindowOrdered(after, before)).toBe(false);
    expect(isWindowOrdered(NOW, NOW)).toBe(false);
    expect(isWindowOrdered(before, after)).toBe(true);
  });
});
