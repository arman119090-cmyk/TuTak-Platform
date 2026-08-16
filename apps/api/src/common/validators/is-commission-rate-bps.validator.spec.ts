import { validateSync } from 'class-validator';
import {
  COMMISSION_RATE_MAX_BPS,
  COMMISSION_RATE_MIN_BPS,
  COMMISSION_RATE_STEP_BPS,
  IsCommissionRateBps,
  isCommissionRateBps,
} from './is-commission-rate-bps.validator';

class RateDto {
  @IsCommissionRateBps()
  bonusAccrualRateBps: unknown;
}

const errorsFor = (value: unknown) => {
  const dto = new RateDto();
  dto.bonusAccrualRateBps = value;
  return validateSync(dto);
};

const GRID = Array.from(
  { length: (COMMISSION_RATE_MAX_BPS - COMMISSION_RATE_MIN_BPS) / COMMISSION_RATE_STEP_BPS + 1 },
  (_, i) => COMMISSION_RATE_MIN_BPS + i * COMMISSION_RATE_STEP_BPS,
);

describe('IsCommissionRateBps', () => {
  it('the grid is exactly 0.5%, 1.0%, ... 20% — 40 values', () => {
    expect(GRID).toHaveLength(40);
    expect(GRID[0]).toBe(50);
    expect(GRID[GRID.length - 1]).toBe(2000);
  });

  it.each(GRID)('accepts %p bps (%p%%)', (bps) => {
    expect(errorsFor(bps)).toHaveLength(0);
    expect(isCommissionRateBps(bps)).toBe(true);
  });

  it.each([
    [0, 'zero — below the 0.5% floor'],
    [-50, 'negative'],
    [10, 'below the grid floor, not on any 0.5% step'],
    [25, 'half a step — the old default-adjacent value that is no longer valid'],
    [2050, 'above the new 20% ceiling'],
    [10_000, 'the old 100% ceiling — must now be rejected'],
    [333, "the audit's own reproduction rate — 3.33%, not a multiple of 50"],
    [175, '1.75% — not a multiple of 50'],
    [125, '1.25% — not a multiple of 50'],
    [51, 'one bps off the grid'],
    [1999, 'one bps short of a grid line'],
    [50.5, 'non-integer'],
  ])('rejects %p bps (%s)', (value) => {
    expect(errorsFor(value)).toHaveLength(1);
    expect(isCommissionRateBps(value)).toBe(false);
  });

  it.each([null, undefined, '500', {}, [], true, NaN])('rejects the non-number %p', (value) => {
    expect(errorsFor(value)).toHaveLength(1);
  });
});
