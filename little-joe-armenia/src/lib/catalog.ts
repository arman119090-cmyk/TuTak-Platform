import "server-only";
import { cache } from "react";
import type { Prisma, ProductFormat } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Locale } from "@/i18n/config";
import { available } from "@/lib/domain/inventory";
import { similarity, type ScentProfile } from "@/lib/domain/scent";

// Read side of the catalog. Every storefront query goes through
// `visibleProductWhere()` so archived, draft and (outside demo mode) demo
// products can never leak onto a public page.

export function visibleProductWhere(): Prisma.ProductWhereInput {
  return {
    status: "ACTIVE",
    collection: { isVisible: true },
    ...(env().DEMO_MODE ? {} : { isDemo: false }),
  };
}

/** Picks the translation for `locale`; falls back to hy, then en, then any. */
export function pickT<T extends { locale: string }>(rows: T[], locale: Locale): T | undefined {
  return (
    rows.find((r) => r.locale === locale) ??
    rows.find((r) => r.locale === "hy") ??
    rows.find((r) => r.locale === "en") ??
    rows[0]
  );
}

const cardInclude = {
  translations: true,
  collection: { include: { translations: true } },
  family: { include: { translations: true } },
  variants: { where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { priceAmd: "asc" }] },
  media: { orderBy: { sortOrder: "asc" }, take: 2 },
} satisfies Prisma.ProductInclude;

type CardRow = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

export type MediaDTO = {
  url: string;
  width: number;
  height: number;
  alt: string;
  kind: string;
  isPlaceholder: boolean;
};

export type ProductCardDTO = {
  id: string;
  slug: string;
  name: string;
  collectionName: string;
  collectionSlug: string;
  descriptor: string | null;
  priceAmd: number | null;
  compareAtAmd: number | null;
  priceIsDemo: boolean;
  variantId: string | null;
  available: number;
  lowStock: boolean;
  accent: string;
  accentInk: string;
  image: MediaDTO | null;
  isBestseller: boolean;
  isNew: boolean;
  isGift: boolean;
  isDemo: boolean;
  familyName: string | null;
  familySlug: string | null;
  intensity: number | null;
};

export const NEUTRAL_ACCENT = "#E9E7E1";
export const NEUTRAL_INK = "#111111";

function altFor(m: { altHy: string | null; altRu: string | null; altIt: string | null; altEn: string | null }, locale: Locale, fallback: string) {
  const byLocale = { hy: m.altHy, ru: m.altRu, it: m.altIt, en: m.altEn }[locale];
  return byLocale ?? fallback;
}

export function toMedia(
  m: CardRow["media"][number],
  locale: Locale,
  fallbackAlt: string,
): MediaDTO {
  return {
    url: m.url,
    width: m.width,
    height: m.height,
    alt: altFor(m, locale, fallbackAlt),
    kind: m.kind,
    // Only generated illustrations are captioned as placeholders; supplied
    // photos whose rights are still UNCONFIRMED are tracked in the admin.
    isPlaceholder: m.rights === "PLACEHOLDER",
  };
}

function toCard(p: CardRow, locale: Locale): ProductCardDTO {
  const t = pickT(p.translations, locale);
  const ct = pickT(p.collection.translations, locale);
  const ft = p.family ? pickT(p.family.translations, locale) : undefined;
  const v = p.variants.find((x) => x.priceAmd !== null) ?? null;
  const avail = v ? available(v) : 0;
  const name = t?.name ?? p.slug;
  return {
    id: p.id,
    slug: p.slug,
    name,
    collectionName: ct?.name ?? p.collection.slug,
    collectionSlug: p.collection.slug,
    // Card descriptor: the confirmed one-liner, else the fragrance family name.
    descriptor: t?.scentDescriptor ?? ft?.name ?? null,
    priceAmd: v?.priceAmd ?? null,
    compareAtAmd: v?.compareAtAmd ?? null,
    priceIsDemo: v?.priceIsDemo ?? false,
    variantId: v?.id ?? null,
    available: avail,
    lowStock: v !== null && avail > 0 && avail <= v.lowStockAt,
    accent: p.accentColor ?? p.collection.accentColor ?? NEUTRAL_ACCENT,
    accentInk: p.accentInk ?? NEUTRAL_INK,
    image: p.media[0] ? toMedia(p.media[0], locale, name) : null,
    isBestseller: p.isBestseller,
    isNew: p.isNew,
    isGift: p.isGift,
    isDemo: p.isDemo,
    familyName: ft?.name ?? null,
    familySlug: p.family?.slug ?? null,
    intensity: p.intensity,
  };
}

// ── Catalog filters ──

export const SORTS = ["featured", "price-asc", "price-desc", "new", "name"] as const;
export type Sort = (typeof SORTS)[number];
export const FORMATS: ProductFormat[] = ["VENT_CLIP", "HANGING", "BOTTLE", "PAPER", "OTHER"];

export type CatalogFilters = {
  q?: string;
  collections: string[];
  families: string[];
  intensity: number[];
  formats: ProductFormat[];
  colors: string[];
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
  bestseller: boolean;
  isNew: boolean;
  gift: boolean;
  sort: Sort;
};

const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? v.split(",") : [])
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && x.length <= 60)
    .slice(0, 20);

const int = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? n : undefined;
};

/** URL search params → filters. Unknown/invalid values are dropped. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): CatalogFilters {
  const qRaw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const sortRaw = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort;
  return {
    q: qRaw ? qRaw.trim().slice(0, 80) || undefined : undefined,
    collections: list(sp.collection),
    families: list(sp.family),
    intensity: list(sp.intensity).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5),
    formats: list(sp.format).filter((f): f is ProductFormat => (FORMATS as string[]).includes(f)),
    colors: list(sp.color),
    minPrice: int(sp.min),
    maxPrice: int(sp.max),
    inStock: sp.stock === "1",
    bestseller: sp.bestseller === "1",
    isNew: sp.new === "1",
    gift: sp.gift === "1",
    sort: (SORTS as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as Sort) : "featured",
  };
}

/** True when any filter narrows the listing (used to noindex filtered pages). */
export function isFiltered(f: CatalogFilters): boolean {
  return Boolean(
    f.q ||
      f.collections.length ||
      f.families.length ||
      f.intensity.length ||
      f.formats.length ||
      f.colors.length ||
      f.minPrice !== undefined ||
      f.maxPrice !== undefined ||
      f.inStock ||
      f.bestseller ||
      f.isNew ||
      f.gift ||
      f.sort !== "featured",
  );
}

function filterWhere(f: CatalogFilters): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [visibleProductWhere()];
  if (f.q) {
    const q = f.q;
    and.push({
      OR: [
        { translations: { some: { name: { contains: q, mode: "insensitive" } } } },
        { translations: { some: { scentDescriptor: { contains: q, mode: "insensitive" } } } },
        { collection: { translations: { some: { name: { contains: q, mode: "insensitive" } } } } },
        { family: { translations: { some: { name: { contains: q, mode: "insensitive" } } } } },
        { scentTags: { some: { tag: { translations: { some: { name: { contains: q, mode: "insensitive" } } } } } } },
        { slug: { contains: q.toLowerCase().replace(/\s+/g, "-") } },
      ],
    });
  }
  if (f.collections.length) and.push({ collection: { slug: { in: f.collections } } });
  if (f.families.length) and.push({ family: { slug: { in: f.families } } });
  if (f.intensity.length) and.push({ intensity: { in: f.intensity } });
  if (f.formats.length) and.push({ format: { in: f.formats } });
  if (f.colors.length) and.push({ colorName: { in: f.colors } });
  if (f.bestseller) and.push({ isBestseller: true });
  if (f.isNew) and.push({ isNew: true });
  if (f.gift) and.push({ isGift: true });
  if (f.minPrice !== undefined || f.maxPrice !== undefined) {
    and.push({
      variants: {
        some: {
          isActive: true,
          priceAmd: {
            ...(f.minPrice !== undefined ? { gte: f.minPrice } : {}),
            ...(f.maxPrice !== undefined ? { lte: f.maxPrice } : {}),
          },
        },
      },
    });
  }
  return { AND: and };
}

export async function listProducts(f: CatalogFilters, locale: Locale): Promise<ProductCardDTO[]> {
  const rows = await db.product.findMany({
    where: filterWhere(f),
    include: cardInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  let cards = rows.map((r) => toCard(r, locale)).filter((c) => c.priceAmd !== null);
  if (f.inStock) cards = cards.filter((c) => c.available > 0);
  const price = (c: ProductCardDTO) => c.priceAmd ?? 0;
  switch (f.sort) {
    case "price-asc":
      cards.sort((a, b) => price(a) - price(b));
      break;
    case "price-desc":
      cards.sort((a, b) => price(b) - price(a));
      break;
    case "new":
      cards.sort((a, b) => Number(b.isNew) - Number(a.isNew));
      break;
    case "name":
      cards.sort((a, b) => a.name.localeCompare(b.name, locale));
      break;
    default:
      // Featured: in stock first, then admin order.
      cards.sort((a, b) => Number(b.available > 0) - Number(a.available > 0));
  }
  return cards;
}

export async function productsByIds(ids: string[], locale: Locale): Promise<ProductCardDTO[]> {
  if (ids.length === 0) return [];
  const rows = await db.product.findMany({ where: { AND: [visibleProductWhere(), { id: { in: ids } }] }, include: cardInclude });
  const byId = new Map(rows.map((r) => [r.id, toCard(r, locale)]));
  return ids.map((id) => byId.get(id)).filter((x): x is ProductCardDTO => Boolean(x));
}

export async function highlighted(kind: "bestseller" | "new" | "featured", locale: Locale, take = 8) {
  const flag =
    kind === "bestseller" ? { isBestseller: true } : kind === "new" ? { isNew: true } : { isFeatured: true };
  const rows = await db.product.findMany({
    where: { AND: [visibleProductWhere(), flag] },
    include: cardInclude,
    orderBy: { sortOrder: "asc" },
    take,
  });
  return rows.map((r) => toCard(r, locale)).filter((c) => c.priceAmd !== null);
}

export async function allVisibleCards(locale: Locale) {
  return listProducts(parseFilters({}), locale);
}

// ── Facets ──

export type Facets = {
  collections: { slug: string; name: string; count: number }[];
  families: { slug: string; name: string; count: number }[];
  intensities: number[];
  formats: ProductFormat[];
  colors: string[];
  priceMin: number;
  priceMax: number;
};

export const getFacets = cache(async (locale: Locale): Promise<Facets> => {
  const rows = await db.product.findMany({
    where: visibleProductWhere(),
    select: {
      intensity: true,
      format: true,
      colorName: true,
      collection: { select: { slug: true, sortOrder: true, translations: true } },
      family: { select: { slug: true, sortOrder: true, translations: true } },
      variants: { where: { isActive: true }, select: { priceAmd: true } },
    },
  });
  const collections = new Map<string, { slug: string; name: string; count: number; order: number }>();
  const families = new Map<string, { slug: string; name: string; count: number; order: number }>();
  const intensities = new Set<number>();
  const formats = new Set<ProductFormat>();
  const colors = new Set<string>();
  const prices: number[] = [];
  for (const r of rows) {
    const c = collections.get(r.collection.slug) ?? {
      slug: r.collection.slug,
      name: pickT(r.collection.translations, locale)?.name ?? r.collection.slug,
      count: 0,
      order: r.collection.sortOrder,
    };
    c.count++;
    collections.set(c.slug, c);
    if (r.family) {
      const f = families.get(r.family.slug) ?? {
        slug: r.family.slug,
        name: pickT(r.family.translations, locale)?.name ?? r.family.slug,
        count: 0,
        order: r.family.sortOrder,
      };
      f.count++;
      families.set(f.slug, f);
    }
    if (r.intensity !== null) intensities.add(r.intensity);
    if (r.format) formats.add(r.format);
    if (r.colorName) colors.add(r.colorName);
    for (const v of r.variants) if (v.priceAmd !== null) prices.push(v.priceAmd);
  }
  const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name);
  return {
    collections: [...collections.values()].sort(byOrder).map(({ order: _o, ...x }) => x),
    families: [...families.values()].sort(byOrder).map(({ order: _o, ...x }) => x),
    intensities: [...intensities].sort(),
    formats: FORMATS.filter((f) => formats.has(f)),
    colors: [...colors].sort(),
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
  };
});

// ── Collections / families ──

export const visibleCollections = cache(async (locale: Locale) => {
  const rows = await db.collection.findMany({
    where: { isVisible: true, products: { some: visibleProductWhere() } },
    include: { translations: true, _count: { select: { products: { where: visibleProductWhere() } } } },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((c) => {
    const t = pickT(c.translations, locale);
    return {
      id: c.id,
      slug: c.slug,
      name: t?.name ?? c.slug,
      description: t?.description ?? null,
      accent: c.accentColor ?? NEUTRAL_ACCENT,
      count: c._count.products,
    };
  });
});

export async function getCollection(slug: string, locale: Locale) {
  const c = await db.collection.findFirst({ where: { slug, isVisible: true }, include: { translations: true } });
  if (!c) return null;
  const t = pickT(c.translations, locale);
  return {
    ...c,
    name: t?.name ?? c.slug,
    description: t?.description ?? null,
    seoTitle: t?.seoTitle ?? null,
    seoDescription: t?.seoDescription ?? null,
  };
}

export async function getFamily(slug: string, locale: Locale) {
  const f = await db.fragranceFamily.findUnique({ where: { slug }, include: { translations: true } });
  if (!f) return null;
  const t = pickT(f.translations, locale);
  return { ...f, name: t?.name ?? f.slug, description: t?.description ?? null };
}

export const visibleFamilies = cache(async (locale: Locale) => {
  const rows = await db.fragranceFamily.findMany({
    where: { products: { some: visibleProductWhere() } },
    include: { translations: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((f) => ({ slug: f.slug, name: pickT(f.translations, locale)?.name ?? f.slug, accent: f.accentColor }));
});

// ── Product detail ──

const detailInclude = {
  translations: true,
  collection: { include: { translations: true } },
  family: { include: { translations: true } },
  scentTags: { include: { tag: { include: { translations: true } } } },
  variants: { where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { priceAmd: "asc" }] },
  media: { orderBy: { sortOrder: "asc" } },
  facts: true,
} satisfies Prisma.ProductInclude;

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

export const getProduct = cache(async (slug: string, locale: Locale) => {
  const p = await db.product.findFirst({ where: { AND: [visibleProductWhere(), { slug }] }, include: detailInclude });
  if (!p) return null;
  const t = pickT(p.translations, locale);
  const card = toCard({ ...p, media: p.media.slice(0, 2) }, locale);
  const verified = new Set(p.facts.filter((f) => f.verification === "VERIFIED").map((f) => f.field));
  const reviews = await db.review.findMany({
    where: { productId: p.id, status: "APPROVED" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, authorName: true, rating: true, body: true, createdAt: true, verifiedPurchase: true, locale: true },
  });
  const stats = await db.review.aggregate({
    where: { productId: p.id, status: "APPROVED" },
    _avg: { rating: true },
    _count: true,
  });
  return {
    card,
    id: p.id,
    slug: p.slug,
    name: card.name,
    t,
    collection: { slug: p.collection.slug, name: card.collectionName, id: p.collectionId },
    family: p.family ? { slug: p.family.slug, name: card.familyName ?? p.family.slug } : null,
    tags: p.scentTags.map((st) => pickT(st.tag.translations, locale)?.name ?? st.tag.slug),
    media: p.media.map((m) => toMedia(m, locale, card.name)),
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      label: v.label,
      priceAmd: v.priceAmd,
      compareAtAmd: v.compareAtAmd,
      priceIsDemo: v.priceIsDemo,
      available: available(v),
    })),
    // Manufacturer facts are shown only when VERIFIED.
    verified: {
      ean: verified.has("EAN") ? p.ean : null,
      articleNumber: verified.has("ARTICLE_NUMBER") ? p.articleNumber : null,
      durationDays: verified.has("DURATION") ? p.durationDays : null,
      dimensions: verified.has("DIMENSIONS") ? p.dimensions : null,
      officialDescription: verified.has("OFFICIAL_DESCRIPTION") ? (t?.officialDescription ?? null) : null,
    },
    facts: p.facts
      .filter((f) => f.verification === "VERIFIED")
      .map((f) => ({ field: f.field, sourceUrl: f.sourceUrl, sourceType: f.sourceType, verifiedAt: f.verifiedAt })),
    scent: {
      intensity: p.intensity,
      sweetness: p.sweetness,
      freshness: p.freshness,
      woodiness: p.woodiness,
      fruity: p.fruity,
      floral: p.floral,
      profileVerified: verified.has("SCENT_PROFILE"),
    },
    format: p.format,
    isDemo: p.isDemo,
    reviews,
    rating: stats._count > 0 ? { average: stats._avg.rating ?? 0, count: stats._count } : null,
    updatedAt: p.updatedAt,
  };
});

const profileSelect = {
  id: true,
  intensity: true,
  sweetness: true,
  freshness: true,
  woodiness: true,
  fruity: true,
  floral: true,
  isGift: true,
  isBestseller: true,
  format: true,
  family: { select: { slug: true } },
  variants: { where: { isActive: true }, select: { stockOnHand: true, reserved: true, priceAmd: true } },
} satisfies Prisma.ProductSelect;

type ProfileRow = Prisma.ProductGetPayload<{ select: typeof profileSelect }>;

export function toProfile(r: ProfileRow): ScentProfile {
  return {
    id: r.id,
    familySlug: r.family?.slug ?? null,
    intensity: r.intensity,
    sweetness: r.sweetness,
    freshness: r.freshness,
    woodiness: r.woodiness,
    fruity: r.fruity,
    floral: r.floral,
    isGift: r.isGift,
    isBestseller: r.isBestseller,
    format: r.format,
    available: r.variants.some((v) => v.priceAmd !== null && available(v) > 0),
  };
}

export async function scentProfiles(): Promise<ScentProfile[]> {
  const rows = await db.product.findMany({ where: visibleProductWhere(), select: profileSelect });
  return rows.map(toProfile);
}

/** Similar scents by confirmed profile; nothing is returned when data is missing. */
export async function similarProducts(productId: string, locale: Locale, take = 4) {
  const profiles = await scentProfiles();
  const me = profiles.find((p) => p.id === productId);
  if (!me) return [];
  const ranked = profiles
    .filter((p) => p.id !== productId)
    .map((p) => ({ id: p.id, s: similarity(me, p) }))
    .filter((x): x is { id: string; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .slice(0, take)
    .map((x) => x.id);
  return productsByIds(ranked, locale);
}

export async function sameCollection(collectionId: string, excludeId: string, locale: Locale, take = 4) {
  const rows = await db.product.findMany({
    where: { AND: [visibleProductWhere(), { collectionId, id: { not: excludeId } }] },
    include: cardInclude,
    orderBy: { sortOrder: "asc" },
    take,
  });
  return rows.map((r) => toCard(r, locale)).filter((c) => c.priceAmd !== null);
}
