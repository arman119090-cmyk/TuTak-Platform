import { Decimal } from '@prisma/client/runtime/library';
import { FastChargeSettlementService } from './fastcharge-settlement.service';

/**
 * The margin/split arithmetic alone, with no database — exercises exactly
 * the worked examples Arman confirmed
 * (docs/FASTCHARGE_INTEGRATION_2026-08-25.md): 80/105/120 AMD/kWh applied
 * against a 75 AMD/kWh wholesale rate and a 20 AMD/kWh referral-split cap.
 * `fastcharge-settlement.int-spec.ts` re-derives the same numbers end to end
 * through the real database, ledger and wallet — this file is the fast,
 * dependency-free half of that proof.
 */
describe('FastChargeSettlementService.computeMargin', () => {
  const wholesaleRatePerKwh = new Decimal('75.00');
  const marginReferralCapPerKwh = new Decimal('20.00');

  const compute = (appliedCustomerRatePerKwh: string, energyKwh: string) =>
    FastChargeSettlementService.computeMargin({
      appliedCustomerRatePerKwh: new Decimal(appliedCustomerRatePerKwh),
      wholesaleRatePerKwh,
      marginReferralCapPerKwh,
      energyKwh: new Decimal(energyKwh),
    });

  it('80 AMD/kWh: margin 5, entirely under the cap, all of it enters the split', () => {
    const result = compute('80', '1');
    expect(result.marginPerKwh.toString()).toBe('5');
    expect(result.pool.toFixed(4)).toBe('5.0000');
    expect(result.uncappedRevenue.toFixed(4)).toBe('0.0000');
  });

  it('105 AMD/kWh: margin 30, 20 through the split, 10 straight TuTak revenue', () => {
    const result = compute('105', '1');
    expect(result.marginPerKwh.toString()).toBe('30');
    expect(result.pool.toFixed(4)).toBe('20.0000');
    expect(result.uncappedRevenue.toFixed(4)).toBe('10.0000');
  });

  it('120 AMD/kWh: margin 45, 20 through the split, 25 straight TuTak revenue', () => {
    const result = compute('120', '1');
    expect(result.marginPerKwh.toString()).toBe('45');
    expect(result.pool.toFixed(4)).toBe('20.0000');
    expect(result.uncappedRevenue.toFixed(4)).toBe('25.0000');
  });

  it('scales with energy delivered, not just rate', () => {
    // 105 AMD/kWh × 10 kWh: the same 20/10 per-kWh split, times ten.
    const result = compute('105', '10');
    expect(result.pool.toFixed(4)).toBe('200.0000');
    expect(result.uncappedRevenue.toFixed(4)).toBe('100.0000');
  });

  it('the cap boundary: exactly at the cap puts everything through the split', () => {
    // 95 AMD/kWh - 75 wholesale = 20 margin, exactly the cap.
    const result = compute('95', '1');
    expect(result.marginPerKwh.toString()).toBe('20');
    expect(result.pool.toFixed(4)).toBe('20.0000');
    expect(result.uncappedRevenue.toFixed(4)).toBe('0.0000');
  });

  it('the cap boundary: one AMD under the cap', () => {
    // 94 AMD/kWh - 75 = 19 margin, just under the 20 cap.
    const result = compute('94', '1');
    expect(result.pool.toFixed(4)).toBe('19.0000');
    expect(result.uncappedRevenue.toFixed(4)).toBe('0.0000');
  });

  it('the cap boundary: one AMD over the cap', () => {
    // 96 AMD/kWh - 75 = 21 margin, just over the 20 cap.
    const result = compute('96', '1');
    expect(result.pool.toFixed(4)).toBe('20.0000');
    expect(result.uncappedRevenue.toFixed(4)).toBe('1.0000');
  });

  it('a tariff at or below wholesale never produces a negative margin', () => {
    const atCost = compute('75', '1');
    expect(atCost.marginPerKwh.toString()).toBe('0');
    expect(atCost.pool.toFixed(4)).toBe('0.0000');

    const belowCost = compute('60', '1');
    expect(belowCost.marginPerKwh.toString()).toBe('0');
    expect(belowCost.pool.toFixed(4)).toBe('0.0000');
    expect(belowCost.uncappedRevenue.toFixed(4)).toBe('0.0000');
  });
});
