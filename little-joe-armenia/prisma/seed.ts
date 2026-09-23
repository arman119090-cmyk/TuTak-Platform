/* Seed script.
 *
 *   pnpm db:seed            reference data only (production-safe)
 *   SEED_DEMO=true pnpm db:seed   + demo catalog (isDemo, shown only with DEMO_MODE=true)
 *
 * Idempotent: safe to run on every deploy. Never overwrites admin edits of
 * existing products (demo products are only created when missing).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Locale } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/security/password";
import { brandClaims, collections, demoProducts, families, importReviewItems } from "./seed-data/catalog";
import { pages } from "./seed-data/pages";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const LOCALES: Locale[] = ["hy", "ru", "it", "en"];
const demo = process.env.SEED_DEMO === "true";

async function reference() {
  for (const f of families) {
    const row = await db.fragranceFamily.upsert({
      where: { slug: f.slug },
      create: { slug: f.slug, sortOrder: f.sortOrder, accentColor: f.accentColor },
      update: {},
    });
    for (const l of LOCALES) {
      await db.fragranceFamilyTranslation.upsert({
        where: { familyId_locale: { familyId: row.id, locale: l } },
        create: { familyId: row.id, locale: l, name: f.name[l], description: f.description[l] },
        update: {},
      });
    }
  }

  for (const c of collections) {
    const row = await db.collection.upsert({
      where: { slug: c.slug },
      create: {
        slug: c.slug,
        sortOrder: c.sortOrder,
        accentColor: c.accentColor,
        verification: "UNVERIFIED",
        sourceType: c.sourceType,
        sourceUrl: c.sourceUrl,
      },
      update: {},
    });
    for (const l of LOCALES) {
      await db.collectionTranslation.upsert({
        where: { collectionId_locale: { collectionId: row.id, locale: l } },
        create: { collectionId: row.id, locale: l, name: c.name[l] },
        update: {},
      });
    }
  }

  for (const [i, c] of brandClaims.entries()) {
    await db.brandClaim.upsert({
      where: { key: c.key },
      create: {
        key: c.key,
        sortOrder: i,
        sourceUrl: c.sourceUrl,
        sourceType: "RETAILER_LISTING",
        verification: "UNVERIFIED",
        titleHy: c.title.hy,
        titleRu: c.title.ru,
        titleIt: c.title.it,
        titleEn: c.title.en,
      },
      update: {},
    });
  }

  for (const p of pages) {
    const row = await db.page.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, legalReviewRequired: p.legalReviewRequired },
      update: {},
    });
    for (const l of LOCALES) {
      await db.pageTranslation.upsert({
        where: { pageId_locale: { pageId: row.id, locale: l } },
        create: { pageId: row.id, locale: l, title: p.t[l].title, body: p.t[l].body, seoDescription: p.t[l].seoDescription },
        update: {},
      });
    }
  }

  // Payment methods: COD on; online methods only in demo (mock adapter).
  const methods = [
    { provider: "CASH_ON_DELIVERY" as const, isEnabled: true, sortOrder: 1 },
    { provider: "IDRAM" as const, isEnabled: demo, sortOrder: 2 },
    { provider: "TELCELL" as const, isEnabled: demo, sortOrder: 3 },
    { provider: "BANK_CARD" as const, isEnabled: demo, sortOrder: 4 },
  ];
  for (const m of methods) {
    await db.paymentMethodSetting.upsert({ where: { provider: m.provider }, create: m, update: {} });
  }

  // Delivery methods. Real prices/zones are commercial decisions: outside
  // demo they are created INACTIVE with price 0 and must be set in admin.
  const delivery = [
    {
      code: "yerevan-courier",
      sortOrder: 1,
      priceAmd: demo ? 1000 : 0,
      freeFromAmd: demo ? 10000 : null,
      regions: ["ER"],
      nameHy: "Առաքում Երևանում",
      nameRu: "Курьер по Еревану",
      nameIt: "Corriere a Erevan",
      nameEn: "Courier in Yerevan",
    },
    {
      code: "armenia-regions",
      sortOrder: 2,
      priceAmd: demo ? 2000 : 0,
      freeFromAmd: demo ? 15000 : null,
      regions: ["AG", "AR", "AV", "GR", "KT", "LO", "SH", "SU", "TV", "VD"],
      nameHy: "Առաքում մարզեր",
      nameRu: "Доставка по регионам Армении",
      nameIt: "Consegna nelle regioni dell'Armenia",
      nameEn: "Delivery to Armenian regions",
    },
  ];
  for (const d of delivery) {
    await db.deliveryMethod.upsert({ where: { code: d.code }, create: { ...d, isActive: demo }, update: {} });
  }

  const hero = await db.homeBlock.findFirst({ where: { kind: "HERO" } });
  if (!hero) {
    await db.homeBlock.create({
      data: {
        kind: "HERO",
        sortOrder: 0,
        titleHy: "Փոքրիկ կերպար։ Ամբողջ տրամադրություն ձեր մեքենայի համար։",
        titleRu: "Маленький персонаж. Целое настроение для вашей машины.",
        titleIt: "Un piccolo personaggio. Tutto un mood per la tua auto.",
        titleEn: "A small character. A whole mood for your car.",
        bodyHy: "Գտեք ձեր ճանապարհին համապատասխան բույրը՝ առաքմամբ Հայաստանում։",
        bodyRu: "Найдите аромат под свой стиль вождения — с доставкой по Армении.",
        bodyIt: "Trova la fragranza giusta per i tuoi viaggi, con consegna in Armenia.",
        bodyEn: "Find the fragrance that fits your drive — delivered in Armenia.",
      },
    });
  }

  const batch = "seed-initial";
  const existingReview = await db.importReview.count({ where: { batch } });
  if (existingReview === 0) {
    for (const r of importReviewItems) {
      await db.importReview.create({
        data: {
          batch,
          entity: r.entity,
          entityKey: r.entityKey,
          field: r.field,
          proposed: r.proposed,
          sourceUrl: r.sourceUrl,
          sourceType: r.sourceUrl ? "RETAILER_LISTING" : "INTERNAL",
          reason: r.reason,
        },
      });
    }
  }
}

async function demoCatalog() {
  const main = await db.collection.findUniqueOrThrow({ where: { slug: "little-joe" } });
  for (const [i, p] of demoProducts.entries()) {
    const exists = await db.product.findUnique({ where: { slug: p.slug } });
    if (exists) continue;
    const family = p.family ? await db.fragranceFamily.findUnique({ where: { slug: p.family } }) : null;
    const hex = p.accent.slice(1);
    const ink = p.ink.slice(1);
    const name = `Little Joe ${p.scentName}`;
    await db.product.create({
      data: {
        slug: p.slug,
        status: "ACTIVE",
        isDemo: true,
        collectionId: main.id,
        format: "VENT_CLIP",
        familyId: family?.id ?? null,
        accentColor: p.accent,
        accentInk: p.ink,
        isBestseller: p.flags.bestseller ?? false,
        isNew: p.flags.isNew ?? false,
        isGift: p.flags.gift ?? false,
        isFeatured: p.flags.featured ?? false,
        sortOrder: i,
        translations: {
          create: LOCALES.map((l) => ({ locale: l, name })),
        },
        variants: {
          create: {
            sku: `DEMO-${p.slug.toUpperCase()}`,
            priceAmd: p.demoPriceAmd,
            priceIsDemo: true,
            stockOnHand: p.demoStock,
            isDefault: true,
          },
        },
        media: {
          create: (["product", "packaging", "installed", "detail"] as const).map((kind, idx) => ({
            kind: kind.toUpperCase() as "PRODUCT" | "PACKAGING" | "INSTALLED" | "DETAIL",
            storageKey: `placeholder/${kind}`,
            url: `/media/placeholder/${kind}.svg?c=${hex}&i=${ink === "FFFFFF" ? "111111" : ink}`,
            width: 800,
            height: 800,
            rights: "PLACEHOLDER",
            rightsNote: "Generated illustration. Replace with authorised photography.",
            sortOrder: idx,
          })),
        },
        facts: {
          create: [
            {
              field: "NAME",
              value: p.scentName,
              sourceType: p.nameSource.type,
              sourceUrl: p.nameSource.url,
              verification: "UNVERIFIED",
              note: "Scent name from task brief / third-party retailer. Confirm against manufacturer catalogue.",
            },
            {
              field: "COLLECTION",
              value: "Little Joe",
              sourceType: "RETAILER_LISTING",
              sourceUrl: RETAILER_FOR_COLLECTION,
              verification: "UNVERIFIED",
            },
            {
              field: "FORMAT",
              value: "VENT_CLIP",
              sourceType: "RETAILER_LISTING",
              sourceUrl: RETAILER_FOR_COLLECTION,
              verification: "UNVERIFIED",
              note: "Retailer copy says the product clips onto an air vent.",
            },
            {
              field: "SCENT_PROFILE",
              value: p.family,
              sourceType: "INTERNAL",
              verification: "UNVERIFIED",
              note: "DEMO placeholder derived from the scent name only. Not manufacturer data.",
            },
          ],
        },
      },
    });
    // Opening stock through the ledger so it reconciles from day one.
    const variant = await db.variant.findFirstOrThrow({ where: { product: { slug: p.slug } } });
    if (p.demoStock > 0) {
      await db.inventoryMovement.create({
        data: {
          variantId: variant.id,
          type: "PURCHASE",
          onHandDelta: p.demoStock,
          onHandAfter: p.demoStock,
          reservedAfter: 0,
          actor: "seed",
          note: "Demo opening stock",
        },
      });
    }
    await db.importReview.create({
      data: {
        batch: "seed-demo",
        entity: "Product",
        entityKey: p.slug,
        field: "*",
        sourceType: p.nameSource.type,
        sourceUrl: p.nameSource.url,
        reason: "Demo product: name, collection, format, family, price and stock are unconfirmed placeholders.",
      },
    });
  }

  const promos = [
    { code: "WELCOME10", name: "Demo: 10% welcome", type: "PERCENT" as const, value: 10, minSubtotalAmd: 5000, usageLimit: 1000 },
    { code: "MINUS500", name: "Demo: −500 AMD", type: "FIXED" as const, value: 500, minSubtotalAmd: 3000, usageLimit: 1 },
  ];
  for (const p of promos) {
    await db.promotion.upsert({ where: { code: p.code }, create: p, update: {} });
  }
}

const RETAILER_FOR_COLLECTION = "https://stonercarcare.com/collections/little-joe";

async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.info("[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — no admin created.");
    return;
  }
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  const existing = await db.adminUser.findUnique({ where: { email } });
  if (existing) return;
  await db.adminUser.create({ data: { email, name: "Owner", role: "OWNER", passwordHash: await hashPassword(password) } });
  await db.auditLog.create({ data: { actor: "seed", action: "admin.bootstrap", entity: "AdminUser", entityId: email } });
  console.info(`[seed] admin ${email} created`);
}

/**
 * Running the seed WITHOUT demo on a database that once had demo data:
 * switch off the demo promo codes (they must never work in production).
 * Demo products stay hidden anyway (isDemo + DEMO_MODE=false).
 */
async function disableDemoLeftovers() {
  const { count } = await db.promotion.updateMany({ where: { code: { in: ["WELCOME10", "MINUS500"] }, isActive: true }, data: { isActive: false } });
  if (count) console.info(`[seed] deactivated ${count} demo promo code(s)`);
}

async function main() {
  await reference();
  if (demo) await demoCatalog();
  else await disableDemoLeftovers();
  await bootstrapAdmin();
  console.info(`[seed] done (demo=${demo})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
