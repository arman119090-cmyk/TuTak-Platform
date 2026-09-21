import { BASE_CURRENCY, type CurrencyCode } from '../money';
import { computeDelivery, computeServices } from './delivery';
import { computeDoorConfig, type DoorOptionRow } from './door';
import { evaluatePromo } from './promo';
import type { PricedPromo, PricedProduct, Quote, QuoteInput, QuoteLine } from './types';

export const MAX_QUANTITY_PER_LINE = 20;
export const MAX_LINES = 40;

/**
 * The single place where an order's money is decided.
 *
 * It is a pure function of (catalogue rows, promo row, door options, request),
 * which is what makes it both unit-testable and safe: the client sends product
 * ids, quantities and option keys — never prices.
 */
export const computeQuote = (
  input: QuoteInput,
  catalogue: PricedProduct[],
  promo: PricedPromo | null,
  doorOptions: DoorOptionRow[] = [],
  now: Date = new Date(),
): Quote => {
  const warnings: string[] = [];
  const byId = new Map(catalogue.map((product) => [product.id, product]));
  const lines: QuoteLine[] = [];
  let currency: CurrencyCode = BASE_CURRENCY;

  for (const item of input.items.slice(0, MAX_LINES)) {
    const product = byId.get(item.productId);
    if (!product) {
      warnings.push(`unknown_product:${item.productId}`);
      continue;
    }
    if (product.stockStatus === 'OUT_OF_STOCK') {
      warnings.push(`out_of_stock:${product.sku}`);
      continue;
    }

    const requested = Math.floor(Number(item.quantity) || 0);
    if (requested < 1) {
      warnings.push(`invalid_quantity:${product.sku}`);
      continue;
    }
    let quantity = Math.min(requested, MAX_QUANTITY_PER_LINE);
    if (product.stockStatus === 'IN_STOCK' && product.stockQty > 0 && quantity > product.stockQty) {
      quantity = product.stockQty;
      warnings.push(`quantity_clamped:${product.sku}`);
    }
    if (quantity !== requested) warnings.push(`quantity_adjusted:${product.sku}`);

    currency = product.currency;

    // Option deltas: only keys that exist on the product are honoured.
    const options: Record<string, string> = {};
    let optionsDelta = 0;
    for (const [kind, valueKey] of Object.entries(item.options ?? {})) {
      const option = product.options.find(
        (entry) => entry.kind === kind && entry.valueKey === valueKey,
      );
      if (!option) {
        warnings.push(`unknown_option:${product.sku}:${kind}:${valueKey}`);
        continue;
      }
      options[kind] = valueKey;
      optionsDelta += option.priceDeltaMinor;
    }

    const isDoor = product.rootCategorySlug === 'doors';
    let doorConfig: Record<string, string> | null = null;
    if (isDoor && item.doorConfig && Object.keys(item.doorConfig).length > 0) {
      const configured = computeDoorConfig(doorOptions, item.doorConfig);
      if (configured.unknownSelections.length > 0)
        warnings.push(
          `unknown_door_option:${product.sku}:${configured.unknownSelections.join(',')}`,
        );
      optionsDelta += configured.deltaMinor;
      doorConfig = Object.fromEntries(
        configured.selected.map((entry) => [entry.groupKey, entry.optionKey]),
      );
    }

    const unitPrice = Math.max(0, product.priceMinor + optionsDelta);
    lines.push({
      productId: product.id,
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      imageUrl: product.imageUrl,
      quantity,
      basePriceMinor: product.priceMinor,
      optionsDeltaMinor: optionsDelta,
      unitPriceMinor: unitPrice,
      oldUnitPriceMinor:
        product.oldPriceMinor !== null ? product.oldPriceMinor + optionsDelta : null,
      lineTotalMinor: unitPrice * quantity,
      options,
      doorConfig,
      isDoor,
      stockStatus: product.stockStatus,
    });
  }

  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const itemsDiscountMinor = lines.reduce(
    (sum, line) =>
      line.oldUnitPriceMinor && line.oldUnitPriceMinor > line.unitPriceMinor
        ? sum + (line.oldUnitPriceMinor - line.unitPriceMinor) * line.quantity
        : sum,
    0,
  );

  const promoResult = input.promoCode ? evaluatePromo(promo, subtotalMinor, now) : null;
  const promoDiscountMinor = promoResult?.ok ? promoResult.discountMinor : 0;
  const payableSubtotal = subtotalMinor - promoDiscountMinor;

  const delivery = computeDelivery(
    input.delivery,
    payableSubtotal,
    promoResult?.ok ? promoResult.freeDelivery : false,
  );
  const services = computeServices(input.services, input.delivery, lines);

  return {
    currency,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor,
    itemsDiscountMinor,
    promoCode: promoResult?.ok ? (promo?.code ?? null) : null,
    promoDiscountMinor,
    promoRejection: promoResult && !promoResult.ok ? promoResult.reason : null,
    promoMinSubtotalMinor:
      promoResult && !promoResult.ok ? (promoResult.minSubtotalMinor ?? null) : null,
    deliveryMinor: delivery.priceMinor,
    deliveryIsFree: delivery.isFree,
    servicesMinor: services.totalMinor,
    serviceBreakdown: services.breakdown,
    totalMinor: payableSubtotal + delivery.priceMinor + services.totalMinor,
    warnings,
  };
};
