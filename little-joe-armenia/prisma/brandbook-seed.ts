// Imports the manufacturer's Brand Book 2027 catalogue (seed-data/brandbook-*.ts).
//
// Runs on every start, so it must be idempotent and must not overwrite the
// owner's edits:
// - A product that already came from the brand book (isDemo = false and the
//   same article number) is left untouched.
// - An old DEMO product with the same slug (e.g. little-joe-vanilla) is
//   converted in place, so carts, orders, reviews and photos the owner
//   uploaded stay attached; the brand-book packshot becomes the first photo.
// - Old DEMO products that are not in the brand book are archived.
//
// Facts from the PDF are VERIFIED with source MANUFACTURER_CATALOG_PDF. An
// EAN that fails its checksum, or appears on two different articles in the
// brand book, is stored as PENDING_REVIEW instead (and not shown).

import type { PrismaClient } from "../src/generated/prisma/client";
import { LINES } from "./seed-data/brandbook-lines";
import { ITEMS } from "./seed-data/brandbook-items";

const LOCALES = ["hy", "ru", "it", "en"] as const;
const SOURCE = "MANUFACTURER_CATALOG_PDF" as const;
const PACKAGING = "PACKAGING" as const;
const DOC = "Brand Book & Product Collection 2027, Drive Int. AG (PDF supplied by the store owner, 2026-09-23)";
const RIGHTS = "Packshot from the manufacturer's Brand Book 2027 (Drive Int. AG), supplied by the store owner on 2026-09-23.";

function eanValid(ean: string): boolean {
  if (!/^\d{13}$/.test(ean)) return false;
  const d = ean.split("").map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// Stock numbers are demo placeholders (the brand book has none). Black Velvet
// stays sold out so the storefront's sold-out state remains visible.
const demoStock = (slug: string) => (slug === "little-joe-black-velvet" ? 0 : 20);
const BESTSELLERS = new Set(["little-joe-new-car", "little-joe-vanilla", "little-joe-cherry", "little-joe-black-velvet", "little-joe-ocean-splash", "little-joya-cotton-candy"]);
const FEATURED = new Set(["little-joe-new-car", "little-joe-vanilla", "little-joe-cherry", "little-joe-fruit", "thumbs-up-cherry", "little-joya-cotton-candy", "little-dog-vanilla", "little-duck-happy-splash"]);
const NEW_2027 = new Set(["little-joe-sport", "little-joe-litchi-rose", "little-joe-white-blossom", "little-joe-wild-strawberry", "little-joe-elegant", "little-cat-new-car", "little-cat-sport", "little-duck-matcha", "little-duck-happy-splash"]);

export async function brandbookCatalog(db: PrismaClient) {
  const eanCount = new Map<string, number>();
  for (const it of ITEMS) eanCount.set(it.ean, (eanCount.get(it.ean) ?? 0) + 1);

  // ── Collections (product lines) ──
  const lineIds = new Map<string, string>();
  for (const line of LINES) {
    if (!ITEMS.some((i) => i.line === line.slug)) continue;
    const existing = await db.collection.findUnique({ where: { slug: line.slug } });
    const fresh = !existing || existing.verification !== "VERIFIED";
    const row = await db.collection.upsert({
      where: { slug: line.slug },
      create: { slug: line.slug, sortOrder: line.sortOrder, accentColor: line.accent, verification: "VERIFIED", sourceType: SOURCE, verifiedAt: new Date(), isVisible: true },
      // Only upgrade collections that came from the old demo seed.
      update: fresh ? { sortOrder: line.sortOrder, accentColor: line.accent, verification: "VERIFIED", sourceType: SOURCE, sourceUrl: null, verifiedAt: new Date(), isVisible: true } : {},
    });
    lineIds.set(line.slug, row.id);
    for (const l of LOCALES) {
      await db.collectionTranslation.upsert({
        where: { collectionId_locale: { collectionId: row.id, locale: l } },
        create: { collectionId: row.id, locale: l, name: line.name[l], description: line.description[l] },
        update: fresh ? { name: line.name[l], description: line.description[l] } : {},
      });
    }
  }

  const families = new Map((await db.fragranceFamily.findMany({ select: { id: true, slug: true } })).map((f) => [f.slug, f.id]));
  let created = 0;
  let converted = 0;

  for (const [i, it] of ITEMS.entries()) {
    const line = LINES.find((l) => l.slug === it.line)!;
    const collectionId = lineIds.get(it.line)!;
    const names = Object.fromEntries(LOCALES.map((l) => [l, `${line.prefix[l]} ${it.label ? it.label[l] : it.scent}`])) as Record<(typeof LOCALES)[number], string>;
    const eanOk = eanValid(it.ean) && eanCount.get(it.ean) === 1;
    const days = line.days45 ? 45 : null;
    const existing = await db.product.findUnique({ where: { slug: it.slug }, include: { variants: true, media: true } });
    if (existing && !existing.isDemo) continue; // already imported — owner edits win

    const product = {
      status: "ACTIVE" as const,
      isDemo: false,
      collectionId,
      articleNumber: it.art,
      ean: it.ean,
      durationDays: days,
      dimensions: it.dims,
      format: line.format,
      familyId: it.family ? (families.get(it.family) ?? null) : null,
      accentColor: line.accent,
      accentInk: "#0B1D36",
      isBestseller: BESTSELLERS.has(it.slug),
      isFeatured: FEATURED.has(it.slug),
      isNew: NEW_2027.has(it.slug),
      sortOrder: line.sortOrder * 100 + i,
    };
    const media = {
      kind: "PACKAGING" as const,
      storageKey: `brand/p/${it.image}`,
      url: `/brand/p/${it.image}`,
      width: it.w,
      height: it.h,
      rights: "AUTHORIZED" as const,
      rightsNote: RIGHTS,
    };
    const facts = [
      { field: "NAME" as const, value: names.en, sourceType: SOURCE, verification: "VERIFIED" as const, note: `${DOC}, p. ${line.page}` },
      { field: "COLLECTION" as const, value: line.name.en, sourceType: SOURCE, verification: "VERIFIED" as const, note: DOC },
      { field: "ARTICLE_NUMBER" as const, value: it.art, sourceType: SOURCE, verification: "VERIFIED" as const, note: DOC },
      {
        field: "EAN" as const,
        value: it.ean,
        sourceType: SOURCE,
        verification: eanOk ? ("VERIFIED" as const) : ("PENDING_REVIEW" as const),
        note: eanOk ? DOC : `${DOC}. Needs review: ${eanValid(it.ean) ? "the same EAN is printed for another article" : "checksum does not match"}.`,
      },
      { field: "OFFICIAL_DESCRIPTION" as const, value: line.description.en, sourceType: SOURCE, verification: "VERIFIED" as const, note: `${DOC}. hy/ru/it are the store's translations.` },
      ...(days ? [{ field: "DURATION" as const, value: String(days), sourceType: PACKAGING, verification: "VERIFIED" as const, note: "“45 days” is printed on the packaging shown in the brand book." }] : []),
      ...(it.dims ? [{ field: "DIMENSIONS" as const, value: it.dims, sourceType: SOURCE, verification: "VERIFIED" as const, note: DOC }] : []),
    ];

    await db.$transaction(async (tx) => {
      let productId: string;
      if (!existing) {
        const p = await tx.product.create({
          data: {
            slug: it.slug,
            ...product,
            variants: {
              create: { sku: it.art, priceAmd: it.price ?? line.demoPriceAmd, priceIsDemo: true, stockOnHand: demoStock(it.slug), isDefault: true },
            },
          },
        });
        productId = p.id;
        await tx.mediaAsset.create({ data: { ...media, productId, sortOrder: 0 } });
        created++;
      } else {
        // Convert an old demo product in place.
        productId = existing.id;
        await tx.product.update({ where: { id: productId }, data: product });
        const v = existing.variants.find((x) => x.isDefault) ?? existing.variants[0];
        if (v) await tx.variant.update({ where: { id: v.id }, data: { sku: it.art, priceIsDemo: true } });
        // Remove the old generated/recoloured seed images; keep the owner's uploads.
        await tx.mediaAsset.deleteMany({ where: { productId, OR: [{ storageKey: { startsWith: "brand/joe_" } }, { storageKey: { startsWith: "brand/char_" } }, { storageKey: { startsWith: "placeholder/" } }] } });
        const first = await tx.mediaAsset.aggregate({ where: { productId }, _min: { sortOrder: true } });
        await tx.mediaAsset.create({ data: { ...media, productId, sortOrder: (first._min.sortOrder ?? 1) - 1 } });
        converted++;
      }
      for (const l of LOCALES) {
        await tx.productTranslation.upsert({
          where: { productId_locale: { productId, locale: l } },
          create: { productId, locale: l, name: names[l], officialDescription: line.description[l] },
          update: { name: names[l], officialDescription: line.description[l] },
        });
      }
      for (const f of facts) {
        await tx.productFact.upsert({
          where: { productId_field: { productId, field: f.field } },
          create: { productId, ...f, verifiedAt: f.verification === "VERIFIED" ? new Date() : null, verifiedBy: "seed:brandbook" },
          update: { ...f, verifiedAt: f.verification === "VERIFIED" ? new Date() : null, verifiedBy: "seed:brandbook" },
        });
      }
    });
  }

  // Old demo products that the brand book does not contain.
  const { count: archived } = await db.product.updateMany({
    where: { isDemo: true, status: { not: "ARCHIVED" }, slug: { notIn: ITEMS.map((i) => i.slug) } },
    data: { status: "ARCHIVED" },
  });
  // Old demo-only collections without active products stay hidden by the storefront.
  if (created || converted || archived) console.info(`[seed] brand book: ${created} created, ${converted} converted from demo, ${archived} demo archived`);
}
