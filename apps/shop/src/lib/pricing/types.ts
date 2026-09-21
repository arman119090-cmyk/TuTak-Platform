import type { CurrencyCode } from '../money';

export type CartItemInput = {
  productId: string;
  quantity: number;
  /** Selected option value keys, e.g. { COLOR: 'graphite', SIZE: '1600x2000' }. */
  options?: Record<string, string>;
  /** Door configurator selection: { groupKey: optionKey }. */
  doorConfig?: Record<string, string>;
};

export type DeliveryInput = {
  method: 'DELIVERY' | 'PICKUP';
  regionKey?: string | null;
  floor?: number | null;
  hasLift?: boolean;
};

export type ServicesInput = {
  lift?: boolean;
  assembly?: boolean;
  doorInstall?: boolean;
};

export type QuoteInput = {
  items: CartItemInput[];
  promoCode?: string | null;
  delivery?: DeliveryInput;
  services?: ServicesInput;
};

/** Minimal product shape the calculator needs — keeps it independent of Prisma. */
export type PricedProduct = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  imageUrl: string;
  currency: CurrencyCode;
  priceMinor: number;
  oldPriceMinor: number | null;
  stockStatus: 'IN_STOCK' | 'ON_ORDER' | 'OUT_OF_STOCK';
  stockQty: number;
  categorySlug: string;
  rootCategorySlug: string;
  options: { kind: string; valueKey: string; label: string | null; priceDeltaMinor: number }[];
};

export type PricedPromo = {
  id: string;
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotalMinor: number | null;
  maxDiscountMinor: number | null;
  freeDelivery: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
};

export type QuoteLine = {
  productId: string;
  sku: string;
  slug: string;
  name: string;
  imageUrl: string;
  quantity: number;
  basePriceMinor: number;
  optionsDeltaMinor: number;
  unitPriceMinor: number;
  oldUnitPriceMinor: number | null;
  lineTotalMinor: number;
  options: Record<string, string>;
  doorConfig: Record<string, string> | null;
  isDoor: boolean;
  stockStatus: PricedProduct['stockStatus'];
};

export type PromoRejection =
  'NOT_FOUND' | 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'USAGE_LIMIT' | 'MIN_SUBTOTAL';

export type Quote = {
  currency: CurrencyCode;
  lines: QuoteLine[];
  itemCount: number;
  subtotalMinor: number;
  /** Savings against the crossed-out prices, for the "you save" line. */
  itemsDiscountMinor: number;
  promoCode: string | null;
  promoDiscountMinor: number;
  promoRejection: PromoRejection | null;
  promoMinSubtotalMinor: number | null;
  deliveryMinor: number;
  deliveryIsFree: boolean;
  servicesMinor: number;
  serviceBreakdown: { key: string; priceMinor: number }[];
  totalMinor: number;
  /** Products that were dropped (deleted/inactive) or clamped. */
  warnings: string[];
};
