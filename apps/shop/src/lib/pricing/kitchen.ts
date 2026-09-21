/**
 * Kitchen quote estimator.
 *
 * A real quote needs a measurement; this gives the customer an honest ballpark
 * on the spot, built from a price per running metre plus multipliers for the
 * layout and the facade. It is deliberately a pure function so the number shown
 * in the form and the number stored on the request can never disagree.
 */

export type KitchenShape = 'straight' | 'lShaped' | 'uShaped' | 'island';
export type KitchenFacade = 'matteLacquer' | 'glossLacquer' | 'veneer' | 'plasticHpl' | 'frameMdf';

/** Price per running metre of composition, AMD minor units. */
const FACADE_PRICE_PER_METER: Record<KitchenFacade, number> = {
  plasticHpl: 185_000,
  frameMdf: 220_000,
  matteLacquer: 260_000,
  glossLacquer: 285_000,
  veneer: 340_000,
};

/** Corners and islands add carcasses and worktop joints, not just length. */
const SHAPE_MULTIPLIER: Record<KitchenShape, number> = {
  straight: 1,
  lShaped: 1.18,
  uShaped: 1.32,
  island: 1.45,
};

export const MIN_KITCHEN_LENGTH_M = 1.5;
export const MAX_KITCHEN_LENGTH_M = 12;

export type KitchenEstimate = {
  /** Lower bound of the range shown to the customer. */
  fromMinor: number;
  /** Upper bound; real quotes land inside this band in the demo's fiction. */
  toMinor: number;
  pricePerMeterMinor: number;
};

export const estimateKitchen = ({
  lengthM,
  shape,
  facade,
}: {
  lengthM: number;
  shape: KitchenShape;
  facade: KitchenFacade;
}): KitchenEstimate => {
  const length = Math.min(MAX_KITCHEN_LENGTH_M, Math.max(MIN_KITCHEN_LENGTH_M, lengthM));
  const perMeter = FACADE_PRICE_PER_METER[facade];
  const base = Math.round(perMeter * length * SHAPE_MULTIPLIER[shape]);
  // Round to the nearest 10 000 dram: a quote to the dram would be a lie.
  const rounded = Math.round(base / 10_000) * 10_000;
  return {
    fromMinor: rounded,
    toMinor: Math.round((rounded * 1.25) / 10_000) * 10_000,
    pricePerMeterMinor: perMeter,
  };
};
