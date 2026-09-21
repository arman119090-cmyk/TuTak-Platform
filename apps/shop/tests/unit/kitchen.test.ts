import { describe, expect, it } from 'vitest';
import { estimateKitchen, MAX_KITCHEN_LENGTH_M, MIN_KITCHEN_LENGTH_M } from '@/lib/pricing/kitchen';

describe('estimateKitchen', () => {
  it('scales with the length of the composition', () => {
    const short = estimateKitchen({ lengthM: 2, shape: 'straight', facade: 'matteLacquer' });
    const long = estimateKitchen({ lengthM: 6, shape: 'straight', facade: 'matteLacquer' });
    expect(long.fromMinor).toBeGreaterThan(short.fromMinor * 2);
  });

  it('charges more for a corner than for a straight run', () => {
    const straight = estimateKitchen({ lengthM: 4, shape: 'straight', facade: 'matteLacquer' });
    const corner = estimateKitchen({ lengthM: 4, shape: 'lShaped', facade: 'matteLacquer' });
    const island = estimateKitchen({ lengthM: 4, shape: 'island', facade: 'matteLacquer' });
    expect(corner.fromMinor).toBeGreaterThan(straight.fromMinor);
    expect(island.fromMinor).toBeGreaterThan(corner.fromMinor);
  });

  it('charges more for veneer than for plastic', () => {
    const plastic = estimateKitchen({ lengthM: 4, shape: 'straight', facade: 'plasticHpl' });
    const veneer = estimateKitchen({ lengthM: 4, shape: 'straight', facade: 'veneer' });
    expect(veneer.fromMinor).toBeGreaterThan(plastic.fromMinor);
  });

  it('clamps absurd lengths instead of returning nonsense', () => {
    const tiny = estimateKitchen({ lengthM: 0.1, shape: 'straight', facade: 'veneer' });
    const huge = estimateKitchen({ lengthM: 900, shape: 'straight', facade: 'veneer' });
    expect(tiny.fromMinor).toBe(
      estimateKitchen({ lengthM: MIN_KITCHEN_LENGTH_M, shape: 'straight', facade: 'veneer' })
        .fromMinor,
    );
    expect(huge.fromMinor).toBe(
      estimateKitchen({ lengthM: MAX_KITCHEN_LENGTH_M, shape: 'straight', facade: 'veneer' })
        .fromMinor,
    );
  });

  it('returns a range whose upper bound is above the lower one, in whole drams', () => {
    const estimate = estimateKitchen({ lengthM: 3.7, shape: 'uShaped', facade: 'glossLacquer' });
    expect(estimate.toMinor).toBeGreaterThan(estimate.fromMinor);
    expect(Number.isInteger(estimate.fromMinor)).toBe(true);
    expect(estimate.fromMinor % 10_000).toBe(0);
  });
});
