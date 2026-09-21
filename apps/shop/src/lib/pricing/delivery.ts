import {
  FREE_DELIVERY_THRESHOLD_MINOR,
  LIFT_PER_FLOOR_MINOR,
  SERVICES,
  regionByKey,
} from '@/config/site';
import type { DeliveryInput, QuoteLine, ServicesInput } from './types';

export type DeliveryResult = { priceMinor: number; isFree: boolean };

/**
 * Delivery tariff by region. Pickup is free; anything at or above the free
 * shipping threshold (or covered by a free-delivery promo) ships at no charge.
 */
export const computeDelivery = (
  delivery: DeliveryInput | undefined,
  payableSubtotalMinor: number,
  promoFreeDelivery = false,
): DeliveryResult => {
  if (!delivery || delivery.method === 'PICKUP') return { priceMinor: 0, isFree: true };
  const region = regionByKey(delivery.regionKey ?? '');
  const base = region?.deliveryMinor ?? 12_000;
  if (promoFreeDelivery || payableSubtotalMinor >= FREE_DELIVERY_THRESHOLD_MINOR)
    return { priceMinor: 0, isFree: true };
  return { priceMinor: base, isFree: false };
};

export type ServicesResult = {
  totalMinor: number;
  breakdown: { key: string; priceMinor: number }[];
};

/**
 * Additional services. "Lift" is a flat call-out plus a per-floor charge when
 * the building has no lift; assembly is per furniture unit; door installation
 * is per door leaf in the order.
 */
export const computeServices = (
  services: ServicesInput | undefined,
  delivery: DeliveryInput | undefined,
  lines: QuoteLine[],
): ServicesResult => {
  const breakdown: { key: string; priceMinor: number }[] = [];
  if (!services) return { totalMinor: 0, breakdown };

  if (services.lift && delivery?.method !== 'PICKUP') {
    const floor = Math.max(0, delivery?.floor ?? 0);
    const hasLift = delivery?.hasLift ?? true;
    const extraFloors = hasLift ? 0 : Math.max(0, floor - 1);
    const price = SERVICES.lift.priceMinor + extraFloors * LIFT_PER_FLOOR_MINOR;
    if (price > 0) breakdown.push({ key: 'lift', priceMinor: price });
  }

  if (services.assembly) {
    const units = lines
      .filter((line) => !line.isDoor)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (units > 0) breakdown.push({ key: 'assembly', priceMinor: SERVICES.assembly.priceMinor * units });
  }

  if (services.doorInstall) {
    const doors = lines.filter((line) => line.isDoor).reduce((sum, line) => sum + line.quantity, 0);
    if (doors > 0)
      breakdown.push({ key: 'doorInstall', priceMinor: SERVICES.doorInstall.priceMinor * doors });
  }

  return {
    totalMinor: breakdown.reduce((sum, entry) => sum + entry.priceMinor, 0),
    breakdown,
  };
};
