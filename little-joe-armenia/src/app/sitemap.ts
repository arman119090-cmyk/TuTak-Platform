import type { MetadataRoute } from "next";
import { locales } from "@/i18n/config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { visibleProductWhere } from "@/lib/catalog";
import { paths } from "@/lib/paths";

export const dynamic = "force-dynamic";

// Only clean, canonical URLs: home, catalog, collections, fragrance
// families, products and content pages — each with all four hreflang
// alternates. Filter/search/sort URLs are deliberately absent. Demo
// products are never listed.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env().APP_URL;
  const visible = { AND: [visibleProductWhere(), { isDemo: false }] };
  const [products, collections, families, pages] = await Promise.all([
    db.product.findMany({ where: visible, select: { slug: true, updatedAt: true } }),
    db.collection.findMany({ where: { isVisible: true, products: { some: visible } }, select: { slug: true, updatedAt: true } }),
    db.fragranceFamily.findMany({ where: { products: { some: visible } }, select: { slug: true } }),
    db.page.findMany({ select: { slug: true, updatedAt: true } }),
  ]);

  const entry = (build: (l: (typeof locales)[number]) => string, lastModified?: Date, priority?: number) =>
    locales.map((l) => ({
      url: new URL(build(l), base).toString(),
      lastModified,
      priority,
      alternates: {
        languages: {
          ...Object.fromEntries(locales.map((x) => [x, new URL(build(x), base).toString()])),
          "x-default": new URL(build("hy"), base).toString(),
        },
      },
    }));

  return [
    ...entry((l) => paths.home(l), undefined, 1),
    ...entry((l) => paths.shop(l), undefined, 0.9),
    ...entry((l) => paths.finder(l), undefined, 0.6),
    ...collections.flatMap((c) => entry((l) => paths.collection(l, c.slug), c.updatedAt, 0.8)),
    ...families.flatMap((f) => entry((l) => paths.family(l, f.slug), undefined, 0.6)),
    ...products.flatMap((p) => entry((l) => paths.product(l, p.slug), p.updatedAt, 0.8)),
    ...pages.flatMap((p) => entry((l) => paths.page(l, p.slug), p.updatedAt, 0.3)),
  ];
}
