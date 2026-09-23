/* Catalog import.
 *
 *   pnpm catalog:import -- path/to/catalog.json [--dry-run]
 *
 * File format: see prisma/seed-data/import-template.json (validated below).
 *
 * Rules (docs/PRODUCT_DATA_SOURCES.md):
 * - Manufacturer facts carry their source. A fact already VERIFIED in the
 *   database is NEVER overwritten silently: a differing value becomes an
 *   ImportReview row for a human to accept/reject.
 * - Unverified facts are updated and keep the source they came with.
 * - Armenia commercial data (price, stock, flags) is a separate block and is
 *   applied directly; stock changes go through the inventory ledger.
 * - Products are created as DRAFT; publishing happens in the admin, which
 *   checks translations and price.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { PrismaClient, type FactField } from "../src/generated/prisma/client";

const source = z.object({
  type: z.enum([
    "MANUFACTURER_WEBSITE",
    "MANUFACTURER_CATALOG_PDF",
    "MANUFACTURER_PRICE_LIST",
    "DISTRIBUTOR_DOCUMENT",
    "PACKAGING",
    "RETAILER_LISTING",
    "INTERNAL",
  ]),
  url: z.string().url().nullable().optional(),
  verified: z.boolean().default(false),
});

const fact = <T extends z.ZodTypeAny>(value: T) => z.object({ value, source }).optional();
const localized = z.object({ hy: z.string().min(1), ru: z.string().min(1), it: z.string().min(1), en: z.string().min(1) });

const productSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,80}$/),
  collection: z.string(),
  manufacturer: z.object({
    name: z.object({ value: localized, source }),
    articleNumber: fact(z.string().max(40)),
    ean: fact(z.string().regex(/^\d{8}$|^\d{13}$/)),
    durationDays: fact(z.number().int().positive().max(365)),
    dimensions: fact(z.string().max(80)),
    colorName: fact(z.string().max(40)),
    format: fact(z.enum(["VENT_CLIP", "HANGING", "BOTTLE", "PAPER", "OTHER"])),
  }),
  armenia: z
    .object({
      sku: z.string().min(1).max(60),
      priceAmd: z.number().int().positive().nullable(),
      stock: z.number().int().min(0).optional(),
      bestseller: z.boolean().optional(),
      featured: z.boolean().optional(),
      isNew: z.boolean().optional(),
      gift: z.boolean().optional(),
    })
    .optional(),
});

const fileSchema = z.object({ batch: z.string().min(1), products: z.array(productSchema) });

function eanValid(ean: string): boolean {
  const d = ean.split("").map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

async function main() {
  const [file, ...flags] = process.argv.slice(2).filter((a) => a !== "--");
  if (!file) throw new Error("usage: pnpm catalog:import -- <file.json> [--dry-run]");
  const dry = flags.includes("--dry-run");
  const data = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const stats = { created: 0, updated: 0, reviews: 0, skipped: 0 };

  try {
    for (const p of data.products) {
      const collection = await db.collection.findUnique({ where: { slug: p.collection } });
      if (!collection) {
        console.warn(`skip ${p.slug}: unknown collection ${p.collection}`);
        stats.skipped++;
        continue;
      }
      if (p.manufacturer.ean && !eanValid(p.manufacturer.ean.value)) {
        console.warn(`skip ${p.slug}: EAN checksum invalid`);
        stats.skipped++;
        continue;
      }
      if (dry) {
        console.info(`[dry-run] would import ${p.slug}`);
        continue;
      }
      let product = await db.product.findUnique({ where: { slug: p.slug }, include: { facts: true } });
      if (!product) {
        product = await db.product.create({
          data: {
            slug: p.slug,
            status: "DRAFT",
            collectionId: collection.id,
            translations: { create: (["hy", "ru", "it", "en"] as const).map((l) => ({ locale: l, name: p.manufacturer.name.value[l] })) },
          },
          include: { facts: true },
        });
        stats.created++;
      } else stats.updated++;

      const m = p.manufacturer;
      const fields: [FactField, string | null, z.infer<typeof source> | undefined, Record<string, unknown>][] = [
        ["NAME", m.name.value.en, m.name.source, {}],
        ["ARTICLE_NUMBER", m.articleNumber?.value ?? null, m.articleNumber?.source, { articleNumber: m.articleNumber?.value }],
        ["EAN", m.ean?.value ?? null, m.ean?.source, { ean: m.ean?.value }],
        ["DURATION", m.durationDays ? String(m.durationDays.value) : null, m.durationDays?.source, { durationDays: m.durationDays?.value }],
        ["DIMENSIONS", m.dimensions?.value ?? null, m.dimensions?.source, { dimensions: m.dimensions?.value }],
        ["COLOR", m.colorName?.value ?? null, m.colorName?.source, { colorName: m.colorName?.value }],
        ["FORMAT", m.format?.value ?? null, m.format?.source, { format: m.format?.value }],
      ];

      for (const [field, value, src, column] of fields) {
        if (!src || value === null) continue;
        const existing = product.facts.find((f) => f.field === field);
        if (existing?.verification === "VERIFIED" && existing.value !== value) {
          await db.importReview.create({
            data: {
              batch: data.batch,
              entity: "Product",
              entityKey: p.slug,
              field,
              current: existing.value,
              proposed: value,
              sourceUrl: src.url ?? null,
              sourceType: src.type,
              reason: "Differs from a VERIFIED value — not applied automatically.",
            },
          });
          stats.reviews++;
          continue;
        }
        const verification = src.verified ? "VERIFIED" : "UNVERIFIED";
        await db.productFact.upsert({
          where: { productId_field: { productId: product.id, field } },
          create: { productId: product.id, field, value, sourceType: src.type, sourceUrl: src.url ?? null, verification, verifiedAt: src.verified ? new Date() : null, verifiedBy: src.verified ? `import:${data.batch}` : null },
          update: { value, sourceType: src.type, sourceUrl: src.url ?? null, verification, verifiedAt: src.verified ? new Date() : null, verifiedBy: src.verified ? `import:${data.batch}` : null },
        });
        if (Object.values(column).some((v) => v !== undefined)) {
          await db.product.update({ where: { id: product.id }, data: column });
        }
      }

      if (p.armenia) {
        const a = p.armenia;
        const variant = await db.variant.upsert({
          where: { sku: a.sku },
          create: { productId: product.id, sku: a.sku, priceAmd: a.priceAmd },
          update: { priceAmd: a.priceAmd, priceIsDemo: false },
        });
        await db.product.update({
          where: { id: product.id },
          data: { isBestseller: a.bestseller, isFeatured: a.featured, isNew: a.isNew, isGift: a.gift },
        });
        if (a.stock !== undefined && a.stock !== variant.stockOnHand) {
          const delta = a.stock - variant.stockOnHand;
          // Same guard as the admin: never below what is reserved.
          const rows = await db.$queryRaw<{ stockOnHand: number; reserved: number }[]>`
            UPDATE "Variant" SET "stockOnHand" = "stockOnHand" + ${delta}, "updatedAt" = now()
            WHERE "id" = ${variant.id} AND "stockOnHand" + ${delta} >= "reserved"
            RETURNING "stockOnHand", "reserved"`;
          if (rows[0]) {
            await db.inventoryMovement.create({
              data: {
                variantId: variant.id,
                type: delta > 0 ? "PURCHASE" : "MANUAL_ADJUSTMENT",
                onHandDelta: delta,
                onHandAfter: rows[0].stockOnHand,
                reservedAfter: rows[0].reserved,
                actor: `import:${data.batch}`,
                note: "Stock set by catalog import",
              },
            });
          } else console.warn(`${p.slug}: stock ${a.stock} is below reserved units — not applied`);
        }
      }
    }
    await db.auditLog.create({ data: { actor: `import:${data.batch}`, action: "catalog.import", entity: "Product", data: stats } });
  } finally {
    await db.$disconnect();
  }
  console.info(`import ${data.batch}:`, stats);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
