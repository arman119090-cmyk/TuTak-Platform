import { cache } from 'react';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import type { Locale } from '../i18n';
import { COLORS, MATERIALS, SPEC_LABELS, SPEC_VALUES, STYLES } from '@/data/attributes';
import { PAGE_SIZE } from '@/config/site';
import type { CatalogFacets, CatalogQuery, CatalogResult, FacetValue, ProductCard } from './types';

const cardSelect = (locale: Locale) =>
  ({
    id: true,
    sku: true,
    slug: true,
    priceMinor: true,
    oldPriceMinor: true,
    discountPct: true,
    currency: true,
    stockStatus: true,
    stockQty: true,
    productionDays: true,
    ratingAvg: true,
    reviewCount: true,
    isNew: true,
    isHit: true,
    isPremium: true,
    colorKeys: true,
    materialKeys: true,
    widthMm: true,
    depthMm: true,
    heightMm: true,
    specs: true,
    brand: { select: { name: true } },
    category: { select: { slug: true, parent: { select: { slug: true } } } },
    // Russian is the fallback copy: a product created with one language must
    // still render a name everywhere, never a bare SKU.
    translations: {
      where: { locale: { in: [locale, 'ru'] } },
      select: { locale: true, name: true, shortDescription: true },
    },
    images: { orderBy: { sort: 'asc' }, take: 2, select: { url: true } },
  }) satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: ReturnType<typeof cardSelect> }>;

/** Picks the requested locale, falling back to Russian, then to anything. */
const pickTranslation = <T extends { locale: string }>(rows: T[], locale: Locale): T | undefined =>
  rows.find((row) => row.locale === locale) ?? rows.find((row) => row.locale === 'ru') ?? rows[0];

export const toProductCard = (row: CardRow, locale: Locale = 'ru'): ProductCard => ({
  id: row.id,
  sku: row.sku,
  slug: row.slug,
  name: pickTranslation(row.translations, locale)?.name ?? row.sku,
  shortDescription: pickTranslation(row.translations, locale)?.shortDescription ?? '',
  priceMinor: row.priceMinor,
  oldPriceMinor: row.oldPriceMinor,
  discountPct: row.discountPct,
  currency: row.currency,
  image: row.images[0]?.url ?? '',
  imageHover: row.images[1]?.url ?? row.images[0]?.url ?? '',
  brandName: row.brand.name,
  categorySlug: row.category.slug,
  rootCategorySlug: row.category.parent?.slug ?? row.category.slug,
  stockStatus: row.stockStatus,
  stockQty: row.stockQty,
  productionDays: row.productionDays,
  ratingAvg: Number(row.ratingAvg),
  reviewCount: row.reviewCount,
  isNew: row.isNew,
  isHit: row.isHit,
  isPremium: row.isPremium,
  colorKeys: row.colorKeys,
  materialKeys: row.materialKeys,
  widthMm: row.widthMm,
  depthMm: row.depthMm,
  heightMm: row.heightMm,
  specs: (row.specs ?? {}) as Record<string, string | number | boolean>,
});

/** Full category tree (roots + children), cached per request. */
export const getCategoryTree = cache(async (locale: Locale) => {
  const roots = await prisma.category.findMany({
    where: { parentId: null, isActive: true },
    orderBy: { sort: 'asc' },
    include: {
      translations: { where: { locale } },
      children: {
        where: { isActive: true },
        orderBy: { sort: 'asc' },
        include: { translations: { where: { locale } }, _count: { select: { products: true } } },
      },
      _count: { select: { products: true } },
    },
  });

  return roots.map((root) => ({
    id: root.id,
    slug: root.slug,
    artKey: root.artKey,
    name: root.translations[0]?.name ?? root.slug,
    description: root.translations[0]?.description ?? '',
    filterKeys: root.filterKeys,
    productCount: root._count.products,
    children: root.children.map((child) => ({
      id: child.id,
      slug: child.slug,
      artKey: child.artKey,
      name: child.translations[0]?.name ?? child.slug,
      productCount: child._count.products,
    })),
  }));
});

export type CategoryTree = Awaited<ReturnType<typeof getCategoryTree>>;

/** One category with its ancestors, children and localized copy. */
export const getCategory = cache(async (slug: string, locale: Locale) => {
  const category = await prisma.category.findUnique({
    where: { slug },
    include: {
      translations: { where: { locale } },
      parent: { include: { translations: { where: { locale } } } },
      children: {
        where: { isActive: true },
        orderBy: { sort: 'asc' },
        include: { translations: { where: { locale } }, _count: { select: { products: true } } },
      },
    },
  });
  if (!category) return null;

  return {
    id: category.id,
    slug: category.slug,
    artKey: category.artKey,
    name: category.translations[0]?.name ?? category.slug,
    description: category.translations[0]?.description ?? '',
    metaTitle: category.translations[0]?.metaTitle ?? null,
    metaDescription: category.translations[0]?.metaDescription ?? null,
    filterKeys: category.filterKeys,
    parent: category.parent
      ? {
          slug: category.parent.slug,
          name: category.parent.translations[0]?.name ?? category.parent.slug,
          filterKeys: category.parent.filterKeys,
        }
      : null,
    children: category.children.map((child) => ({
      slug: child.slug,
      name: child.translations[0]?.name ?? child.slug,
      artKey: child.artKey,
      productCount: child._count.products,
    })),
  };
});

/** Slugs of a category and everything below it. */
const categoryScope = async (slug: string): Promise<string[]> => {
  const category = await prisma.category.findUnique({
    where: { slug },
    select: { id: true, children: { select: { id: true } } },
  });
  if (!category) return [];
  return [category.id, ...category.children.map((child) => child.id)];
};

const buildWhere = async (query: CatalogQuery): Promise<Prisma.ProductWhereInput> => {
  const where: Prisma.ProductWhereInput = { isActive: true };
  const and: Prisma.ProductWhereInput[] = [];

  if (query.categorySlug) {
    const ids = await categoryScope(query.categorySlug);
    where.categoryId = { in: ids.length > 0 ? ids : ['__none__'] };
  }
  if (query.search) {
    const terms = query.search.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const term of terms) and.push({ searchText: { contains: term } });
  }
  if (query.brands?.length) where.brand = { slug: { in: query.brands } };
  if (query.colors?.length) where.colorKeys = { hasSome: query.colors };
  if (query.materials?.length) where.materialKeys = { hasSome: query.materials };
  if (query.styles?.length) where.styleKey = { in: query.styles };
  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    where.priceMinor = {
      ...(query.priceMin !== undefined ? { gte: query.priceMin } : {}),
      ...(query.priceMax !== undefined ? { lte: query.priceMax } : {}),
    };
  }
  if (query.widthMin !== undefined || query.widthMax !== undefined) {
    where.widthMm = {
      ...(query.widthMin !== undefined ? { gte: query.widthMin } : {}),
      ...(query.widthMax !== undefined ? { lte: query.widthMax } : {}),
    };
  }
  if (query.inStock) where.stockStatus = 'IN_STOCK';
  if (query.discounted) where.oldPriceMinor = { not: null };
  if (query.ratingFrom) where.ratingAvg = { gte: query.ratingFrom };

  for (const [key, values] of Object.entries(query.specs ?? {})) {
    if (!values.length) continue;
    and.push({
      OR: values.map((value) => ({
        specs: { path: [key], equals: value === 'true' ? true : value === 'false' ? false : value },
      })),
    });
  }

  if (and.length) where.AND = and;
  return where;
};

const ORDER_BY: Record<string, Prisma.ProductOrderByWithRelationInput[]> = {
  popular: [{ salesCount: 'desc' }, { ratingAvg: 'desc' }],
  'price-asc': [{ priceMinor: 'asc' }],
  'price-desc': [{ priceMinor: 'desc' }],
  new: [{ createdAt: 'desc' }, { isNew: 'desc' }],
  rating: [{ ratingAvg: 'desc' }, { reviewCount: 'desc' }],
  discount: [{ discountPct: 'desc' }],
};

const buildFacets = async (query: CatalogQuery, locale: Locale): Promise<CatalogFacets> => {
  // Facet counts ignore the facet filters themselves so a customer can always
  // see (and switch to) the other options inside the current category.
  const scopeWhere = await buildWhere({
    categorySlug: query.categorySlug,
    search: query.search,
    locale,
  });
  const rows = await prisma.product.findMany({
    where: scopeWhere,
    select: {
      brand: { select: { slug: true, name: true } },
      colorKeys: true,
      materialKeys: true,
      styleKey: true,
      priceMinor: true,
      stockStatus: true,
      oldPriceMinor: true,
      specs: true,
      category: {
        select: { slug: true, filterKeys: true, parent: { select: { filterKeys: true } } },
      },
    },
  });

  const countBy = (values: string[][]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const group of values) {
      for (const value of new Set(group)) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  };

  const brandNames = new Map<string, string>();
  for (const row of rows) brandNames.set(row.brand.slug, row.brand.name);

  const toFacet = (counts: Map<string, number>, label: (key: string) => string): FacetValue[] =>
    [...counts.entries()]
      .map(([key, count]) => ({ key, label: label(key), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const specKeys = new Set<string>();
  for (const row of rows) {
    for (const key of row.category.filterKeys) specKeys.add(key);
    for (const key of row.category.parent?.filterKeys ?? []) specKeys.add(key);
  }
  // Numeric/free-form specs are not useful as checkbox facets.
  const ENUMERABLE = new Set([
    'mechanism',
    'filler',
    'cornerSide',
    'baseType',
    'headboard',
    'springType',
    'rigidity',
    'tableShape',
    'facadeType',
    'configuration',
    'coating',
    'openingType',
    'openingSide',
    'hardware',
    'ageGroup',
    'seats',
    'doorsCount',
    'drawersCount',
    'shelvesCount',
    'seatsCount',
    'liftMechanism',
    'linenBox',
    'mirror',
    'extendable',
    'madeToMeasure',
    'adjustableHeight',
    'cableManagement',
    'stackable',
    'frameIncluded',
  ]);

  const specFacets = [...specKeys]
    .filter((key) => ENUMERABLE.has(key))
    .map((key) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const specs = row.specs as Record<string, string | number | boolean> | null;
        const value = specs?.[key];
        if (value === undefined || value === null) continue;
        const asKey = String(value);
        counts.set(asKey, (counts.get(asKey) ?? 0) + 1);
      }
      return {
        key,
        label: SPEC_LABELS[key]?.[locale] ?? key,
        values: toFacet(counts, (value) =>
          value === 'true'
            ? SPEC_VALUES.yes![locale]
            : value === 'false'
              ? SPEC_VALUES.no![locale]
              : (SPEC_VALUES[`${key}.${value}`]?.[locale] ?? value),
        ).slice(0, 12),
      };
    })
    .filter((facet) => facet.values.length > 1);

  const prices = rows.map((row) => row.priceMinor);
  return {
    brands: toFacet(
      countBy(rows.map((row) => [row.brand.slug])),
      (key) => brandNames.get(key) ?? key,
    ),
    colors: toFacet(
      countBy(rows.map((row) => row.colorKeys)),
      (key) => COLORS[key]?.label[locale] ?? key,
    ),
    materials: toFacet(
      countBy(rows.map((row) => row.materialKeys)),
      (key) => MATERIALS[key]?.label[locale] ?? key,
    ),
    styles: toFacet(
      countBy(rows.map((row) => [row.styleKey])),
      (key) => STYLES[key]?.[locale] ?? key,
    ),
    specs: specFacets,
    priceMinMinor: prices.length ? Math.min(...prices) : 0,
    priceMaxMinor: prices.length ? Math.max(...prices) : 0,
    inStockCount: rows.filter((row) => row.stockStatus === 'IN_STOCK').length,
    discountedCount: rows.filter((row) => row.oldPriceMinor !== null).length,
  };
};

export const queryCatalog = async (query: CatalogQuery): Promise<CatalogResult> => {
  const pageSize = Math.min(query.pageSize ?? PAGE_SIZE, 60);
  const page = Math.max(1, query.page ?? 1);
  const where = await buildWhere(query);

  const [total, rows, facets] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: ORDER_BY[query.sort ?? 'popular'] ?? ORDER_BY.popular,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: cardSelect(query.locale),
    }),
    buildFacets(query, query.locale),
  ]);

  return {
    items: rows.map((row) => toProductCard(row, query.locale)),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    facets,
  };
};

/** Full product page payload. */
export const getProduct = cache(async (slug: string, locale: Locale) => {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      translations: { where: { locale: { in: [locale, 'ru'] } } },
      images: { orderBy: { sort: 'asc' } },
      options: { orderBy: [{ kind: 'asc' }, { sort: 'asc' }] },
      brand: { include: { translations: { where: { locale } } } },
      collection: { include: { translations: { where: { locale } } } },
      category: {
        include: {
          translations: { where: { locale } },
          parent: { include: { translations: { where: { locale } } } },
        },
      },
      reviews: { where: { isPublished: true }, orderBy: { createdAt: 'desc' }, take: 12 },
    },
  });
  if (!product || !product.isActive) return null;

  const copy = pickTranslation(product.translations, locale);
  return {
    ...product,
    ratingAvg: Number(product.ratingAvg),
    name: copy?.name ?? product.sku,
    shortDescription: copy?.shortDescription ?? '',
    description: copy?.description ?? '',
    metaTitle: copy?.metaTitle ?? null,
    metaDescription: copy?.metaDescription ?? null,
    categoryName: product.category.translations[0]?.name ?? product.category.slug,
    parentCategory: product.category.parent
      ? {
          slug: product.category.parent.slug,
          name: product.category.parent.translations[0]?.name ?? product.category.parent.slug,
        }
      : null,
    brandName: product.brand.name,
    brandTagline: product.brand.translations[0]?.tagline ?? '',
    collectionName: product.collection?.name ?? null,
    specs: (product.specs ?? {}) as Record<string, string | number | boolean>,
  };
});

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

export const getProductCardsByIds = async (
  ids: string[],
  locale: Locale,
): Promise<ProductCard[]> => {
  if (ids.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: ids }, isActive: true },
    select: cardSelect(locale),
  });
  const byId = new Map(rows.map((row) => [row.id, toProductCard(row, locale)]));
  return ids.map((id) => byId.get(id)).filter((card): card is ProductCard => Boolean(card));
};

/** "Similar products": same category, closest price, never the product itself. */
export const getSimilarProducts = async (
  product: { id: string; categoryId: string; priceMinor: number },
  locale: Locale,
  take = 8,
): Promise<ProductCard[]> => {
  const rows = await prisma.product.findMany({
    where: {
      isActive: true,
      categoryId: product.categoryId,
      id: { not: product.id },
      priceMinor: {
        gte: Math.round(product.priceMinor * 0.5),
        lte: Math.round(product.priceMinor * 1.8),
      },
    },
    orderBy: [{ salesCount: 'desc' }],
    take,
    select: cardSelect(locale),
  });
  return rows.map((row) => toProductCard(row, locale));
};

export const getCollectionProducts = async (
  collectionId: string | null,
  excludeId: string,
  locale: Locale,
  take = 8,
): Promise<ProductCard[]> => {
  if (!collectionId) return [];
  const rows = await prisma.product.findMany({
    where: { isActive: true, collectionId, id: { not: excludeId } },
    take,
    select: cardSelect(locale),
  });
  return rows.map((row) => toProductCard(row, locale));
};

type HomeSectionKey =
  | 'popular'
  | 'new'
  | 'discounts'
  | 'kitchens'
  | 'doors'
  | 'bedroom'
  | 'living'
  | 'tablesChairs'
  | 'smallSpace'
  | 'premium'
  | 'inStock';

/** All product rails on the homepage, in one round trip per rail. */
export const getHomeSections = cache(
  async (locale: Locale): Promise<Record<HomeSectionKey, ProductCard[]>> => {
    const select = cardSelect(locale);
    const take = 8;
    const rootScope = async (slug: string) => ({ categoryId: { in: await categoryScope(slug) } });

    const [kitchensWhere, doorsWhere] = await Promise.all([
      rootScope('kitchens'),
      rootScope('doors'),
    ]);
    const [bedroomWhere, livingWhere] = await Promise.all([
      Promise.resolve({ roomKey: 'bedroom' }),
      Promise.resolve({ roomKey: 'living' }),
    ]);

    const [
      popular,
      fresh,
      discounts,
      kitchens,
      doors,
      bedroom,
      living,
      tablesChairs,
      smallSpace,
      premium,
      inStock,
    ] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true, isHit: true },
        orderBy: { salesCount: 'desc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: { isActive: true, isNew: true },
        orderBy: { createdAt: 'desc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: { isActive: true, oldPriceMinor: { not: null } },
        orderBy: { discountPct: 'desc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: { isActive: true, ...kitchensWhere },
        orderBy: { salesCount: 'desc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: { isActive: true, ...doorsWhere },
        orderBy: { salesCount: 'desc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: { isActive: true, ...bedroomWhere },
        orderBy: { ratingAvg: 'desc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: { isActive: true, ...livingWhere },
        orderBy: { ratingAvg: 'desc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: {
          isActive: true,
          category: {
            slug: { in: ['dining-tables', 'dining-chairs', 'kitchen-chairs', 'designer-chairs'] },
          },
        },
        orderBy: { salesCount: 'desc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: { isActive: true, smallSpace: true },
        orderBy: { priceMinor: 'asc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: { isActive: true, isPremium: true },
        orderBy: { priceMinor: 'desc' },
        take,
        select,
      }),
      prisma.product.findMany({
        where: { isActive: true, stockStatus: 'IN_STOCK' },
        orderBy: { salesCount: 'desc' },
        take,
        select,
      }),
    ]);

    return {
      popular: popular.map((row) => toProductCard(row, locale)),
      new: fresh.map((row) => toProductCard(row, locale)),
      discounts: discounts.map((row) => toProductCard(row, locale)),
      kitchens: kitchens.map((row) => toProductCard(row, locale)),
      doors: doors.map((row) => toProductCard(row, locale)),
      bedroom: bedroom.map((row) => toProductCard(row, locale)),
      living: living.map((row) => toProductCard(row, locale)),
      tablesChairs: tablesChairs.map((row) => toProductCard(row, locale)),
      smallSpace: smallSpace.map((row) => toProductCard(row, locale)),
      premium: premium.map((row) => toProductCard(row, locale)),
      inStock: inStock.map((row) => toProductCard(row, locale)),
    };
  },
);

export const getBanners = cache(async (locale: Locale, position: 'HOME_HERO' | 'HOME_STRIP') => {
  const banners = await prisma.banner.findMany({
    where: { isActive: true, position },
    orderBy: { sort: 'asc' },
    include: { translations: { where: { locale } } },
  });
  return banners.map((banner) => ({
    key: banner.key,
    href: banner.href,
    artKey: banner.artKey,
    eyebrow: banner.translations[0]?.eyebrow ?? '',
    title: banner.translations[0]?.title ?? '',
    subtitle: banner.translations[0]?.subtitle ?? '',
    ctaLabel: banner.translations[0]?.ctaLabel ?? '',
  }));
});

/** Autocomplete: matched products plus the categories those products live in. */
export const searchSuggest = async (query: string, locale: Locale) => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  if (terms.length === 0) return { products: [], categories: [] };

  const rows = await prisma.product.findMany({
    where: { isActive: true, AND: terms.map((term) => ({ searchText: { contains: term } })) },
    orderBy: [{ salesCount: 'desc' }, { ratingAvg: 'desc' }],
    take: 6,
    select: cardSelect(locale),
  });

  const categories = await prisma.category.findMany({
    where: {
      isActive: true,
      translations: { some: { locale, name: { contains: terms[0]!, mode: 'insensitive' } } },
    },
    take: 4,
    include: { translations: { where: { locale } }, _count: { select: { products: true } } },
  });

  return {
    products: rows.map((row) => toProductCard(row, locale)),
    categories: categories.map((category) => ({
      slug: category.slug,
      name: category.translations[0]?.name ?? category.slug,
      count: category._count.products,
    })),
  };
};

export const countProducts = cache(async (): Promise<number> =>
  prisma.product.count({ where: { isActive: true } }),
);
