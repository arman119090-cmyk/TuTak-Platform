import { describe, expect, it } from 'vitest';
import { computeDoorConfig, REQUIRED_DOOR_GROUPS, type DoorOptionRow } from '@/lib/pricing/door';

const rows: DoorOptionRow[] = [
  {
    groupKey: 'size',
    optionKey: '800x2000',
    priceMinor: 8_000,
    sort: 0,
    isActive: true,
    labels: {},
  },
  {
    groupKey: 'size',
    optionKey: '900x2000',
    priceMinor: 14_000,
    sort: 1,
    isActive: true,
    labels: {},
  },
  {
    groupKey: 'coating',
    optionKey: 'laminate',
    priceMinor: 0,
    sort: 0,
    isActive: true,
    labels: {},
  },
  {
    groupKey: 'coating',
    optionKey: 'enamel',
    priceMinor: 26_000,
    sort: 1,
    isActive: true,
    labels: {},
  },
  { groupKey: 'color', optionKey: 'oak', priceMinor: 6_000, sort: 0, isActive: true, labels: {} },
  { groupKey: 'opening', optionKey: 'left', priceMinor: 0, sort: 0, isActive: true, labels: {} },
  {
    groupKey: 'handle',
    optionKey: 'brass',
    priceMinor: 19_000,
    sort: 0,
    isActive: true,
    labels: {},
  },
  {
    groupKey: 'installation',
    optionKey: 'standard',
    priceMinor: 25_000,
    sort: 0,
    isActive: true,
    labels: {},
  },
  {
    groupKey: 'installation',
    optionKey: 'retired',
    priceMinor: 99_000,
    sort: 9,
    isActive: false,
    labels: {},
  },
];

const complete = {
  size: '800x2000',
  coating: 'enamel',
  color: 'oak',
  opening: 'left',
};

describe('computeDoorConfig', () => {
  it('sums the deltas of the chosen options', () => {
    const result = computeDoorConfig(rows, {
      ...complete,
      handle: 'brass',
      installation: 'standard',
    });
    expect(result.deltaMinor).toBe(8_000 + 26_000 + 6_000 + 0 + 19_000 + 25_000);
    expect(result.ok).toBe(true);
  });

  it('reports the required groups that are still missing', () => {
    const result = computeDoorConfig(rows, { size: '800x2000' });
    expect(result.ok).toBe(false);
    expect(result.missingGroups).toEqual(REQUIRED_DOOR_GROUPS.filter((group) => group !== 'size'));
  });

  it('refuses an option that does not exist', () => {
    const result = computeDoorConfig(rows, { ...complete, handle: 'diamond' });
    expect(result.ok).toBe(false);
    expect(result.unknownSelections).toContain('handle:diamond');
    // The bogus option contributes nothing to the price.
    expect(result.deltaMinor).toBe(40_000);
  });

  it('refuses a deactivated option', () => {
    const result = computeDoorConfig(rows, { ...complete, installation: 'retired' });
    expect(result.unknownSelections).toContain('installation:retired');
    expect(result.deltaMinor).toBe(40_000);
  });

  it('treats an empty selection as incomplete rather than free', () => {
    const result = computeDoorConfig(rows, {});
    expect(result.ok).toBe(false);
    expect(result.deltaMinor).toBe(0);
  });

  it('prices a bigger leaf higher than a smaller one', () => {
    const small = computeDoorConfig(rows, complete).deltaMinor;
    const large = computeDoorConfig(rows, { ...complete, size: '900x2000' }).deltaMinor;
    expect(large).toBeGreaterThan(small);
  });
});
