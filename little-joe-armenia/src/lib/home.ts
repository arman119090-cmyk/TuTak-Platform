import "server-only";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";
import { highlighted, productsByIds, visibleProductWhere, pickT } from "@/lib/catalog";

type Localised = { titleHy: string; titleRu: string; titleIt: string; titleEn: string; bodyHy: string | null; bodyRu: string | null; bodyIt: string | null; bodyEn: string | null };

export function localisedBlock(b: Localised, locale: Locale) {
  const title = { hy: b.titleHy, ru: b.titleRu, it: b.titleIt, en: b.titleEn }[locale];
  const body = { hy: b.bodyHy, ru: b.bodyRu, it: b.bodyIt, en: b.bodyEn }[locale];
  return { title, body };
}

export async function homeContent(locale: Locale) {
  const [blocks, featuredRows] = await Promise.all([
    db.homeBlock.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.homeFeaturedProduct.findMany({ where: { product: visibleProductWhere() }, orderBy: { sortOrder: "asc" } }),
  ]);
  const featured = featuredRows.length
    ? await productsByIds(featuredRows.map((r) => r.productId), locale)
    : await highlighted("featured", locale, 10);
  const hero = blocks.find((b) => b.kind === "HERO");
  const campaigns = blocks.filter((b) => b.kind === "CAMPAIGN");
  return {
    hero: hero ? { ...localisedBlock(hero, locale), accent: hero.accentColor } : null,
    campaigns: campaigns.map((c) => ({ id: c.id, href: c.href, accent: c.accentColor, ...localisedBlock(c, locale) })),
    featured,
  };
}

export async function verifiedBrandClaims(locale: Locale) {
  const rows = await db.brandClaim.findMany({ where: { verification: "VERIFIED" }, orderBy: { sortOrder: "asc" } });
  return rows.map((r) => ({
    key: r.key,
    title: { hy: r.titleHy, ru: r.titleRu, it: r.titleIt, en: r.titleEn }[locale],
    body: { hy: r.bodyHy, ru: r.bodyRu, it: r.bodyIt, en: r.bodyEn }[locale],
    sourceUrl: r.sourceUrl,
  }));
}

export async function latestReviews(take = 6) {
  const rows = await db.review.findMany({
    where: { status: "APPROVED", product: visibleProductWhere() },
    orderBy: { createdAt: "desc" },
    take,
    include: { product: { select: { slug: true, translations: true } } },
  });
  return rows;
}

export async function lifestyleMedia(locale: Locale, take = 6) {
  const rows = await db.mediaAsset.findMany({
    where: { kind: { in: ["LIFESTYLE", "INSTALLED"] }, rights: "AUTHORIZED", product: visibleProductWhere() },
    orderBy: { createdAt: "desc" },
    take,
    include: { product: { select: { slug: true, translations: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    width: r.width,
    height: r.height,
    alt: { hy: r.altHy, ru: r.altRu, it: r.altIt, en: r.altEn }[locale] ?? pickT(r.product?.translations ?? [], locale)?.name ?? "",
    productSlug: r.product?.slug ?? null,
  }));
}
