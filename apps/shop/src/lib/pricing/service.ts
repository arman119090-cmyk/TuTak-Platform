import { prisma } from '../prisma';
import type { Locale } from '../i18n';
import type { CurrencyCode } from '../money';
import { computeQuote } from './quote';
import type { DoorOptionRow } from './door';
import type { PricedProduct, PricedPromo, Quote, QuoteInput } from './types';

/** Loads exactly the catalogue rows a quote needs, in one round trip. */
export const loadPricedProducts = async (
  productIds: string[],
  locale: Locale,
): Promise<PricedProduct[]> => {
  if (productIds.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    include: {
      category: { include: { parent: true } },
      translations: { where: { locale } },
      images: { orderBy: { sort: 'asc' }, take: 1 },
      options: true,
    },
  });

  return products.map((product) => ({
    id: product.id,
    sku: product.sku,
    slug: product.slug,
    name: product.translations[0]?.name ?? product.sku,
    imageUrl: product.images[0]?.url ?? '',
    currency: product.currency as CurrencyCode,
    priceMinor: product.priceMinor,
    oldPriceMinor: product.oldPriceMinor,
    stockStatus: product.stockStatus,
    stockQty: product.stockQty,
    categorySlug: product.category.slug,
    rootCategorySlug: product.category.parent?.slug ?? product.category.slug,
    options: product.options.map((option) => ({
      kind: option.kind,
      valueKey: option.valueKey,
      label: option.label,
      priceDeltaMinor: option.priceDeltaMinor,
    })),
  }));
};

export const loadPromo = async (code: string | null | undefined): Promise<PricedPromo | null> => {
  if (!code) return null;
  const promo = await prisma.promoCode.findUnique({ where: { code: code.trim().toUpperCase() } });
  return promo as PricedPromo | null;
};

export const loadDoorOptions = async (): Promise<DoorOptionRow[]> => {
  const rows = await prisma.doorConfigOption.findMany({ orderBy: [{ groupKey: 'asc' }, { sort: 'asc' }] });
  return rows.map((row) => ({
    groupKey: row.groupKey,
    optionKey: row.optionKey,
    priceMinor: row.priceMinor,
    labels: (row.labels ?? {}) as Record<string, string>,
    sort: row.sort,
    isActive: row.isActive,
  }));
};

/**
 * Server-side cart quote. Everything the customer sees as a price — line
 * totals, promo discount, delivery, services, grand total — comes from here.
 */
export const quoteCart = async (input: QuoteInput, locale: Locale): Promise<Quote> => {
  const ids = [...new Set(input.items.map((item) => item.productId))];
  const needsDoorOptions = input.items.some(
    (item) => item.doorConfig && Object.keys(item.doorConfig).length > 0,
  );
  const [catalogue, promo, doorOptions] = await Promise.all([
    loadPricedProducts(ids, locale),
    loadPromo(input.promoCode),
    needsDoorOptions ? loadDoorOptions() : Promise.resolve([] as DoorOptionRow[]),
  ]);
  return computeQuote(input, catalogue, promo, doorOptions);
};
