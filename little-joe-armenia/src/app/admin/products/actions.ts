"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { FactField, Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adjust, InsufficientStockError } from "@/lib/domain/inventory";
import { adminAction, parse } from "@/lib/admin/action";
import { requireAdmin } from "@/lib/admin/auth";
import { publishBlockers } from "@/lib/admin/catalog";
import {
  b,
  fail,
  isValidEan,
  list,
  ok,
  optHex,
  optInt,
  optText,
  optUrl,
  reqInt,
  s,
  slugSchema,
  type ActionState,
} from "@/lib/admin/forms";
import { LOCALES } from "@/lib/admin/format";
import { revalidateAdmin, revalidateStore } from "@/lib/admin/revalidate";

const id = z.string().min(1).max(40);
const localeEnum = z.enum(LOCALES);
const verificationEnum = z.enum(["UNVERIFIED", "PENDING_REVIEW", "VERIFIED", "REJECTED"]);
const sourceEnum = z.enum([
  "MANUFACTURER_WEBSITE",
  "MANUFACTURER_CATALOG_PDF",
  "MANUFACTURER_PRICE_LIST",
  "DISTRIBUTOR_DOCUMENT",
  "PACKAGING",
  "RETAILER_LISTING",
  "TASK_BRIEF",
  "INTERNAL",
]);

/** Rolls a transaction back with a user-facing message. */
class Refused extends Error {}

async function guardPublished(tx: Tx, productId: string) {
  const p = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: { status: true, translations: { select: { locale: true, name: true } }, variants: { select: { isActive: true, priceAmd: true } } },
  });
  if (p.status !== "ACTIVE") return;
  const blockers = publishBlockers(p);
  if (blockers.length) {
    throw new Refused(`Товар опубликован, после изменения его нельзя было бы показывать: ${blockers.join("; ")}. Сначала снимите с публикации.`);
  }
}

function refusedToState(e: unknown): ActionState | null {
  if (e instanceof Refused) return fail(e.message);
  if (e instanceof InsufficientStockError) return fail("Нельзя списать больше, чем есть на складе сверх резерва.");
  return null;
}

// ─────────────────────────────── Create ───────────────────────────────

export async function createProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin("productCommerce");
  const { data, error } = parse(
    z.object({
      slug: slugSchema,
      collectionId: id,
      names: z.record(localeEnum, optText(160)),
    }),
    {
      slug: s(fd, "slug"),
      collectionId: s(fd, "collectionId"),
      names: Object.fromEntries(LOCALES.map((l) => [l, s(fd, `name_${l}`)])),
    },
  );
  if (error) return error;
  let productId: string;
  try {
    productId = await db.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          slug: data.slug,
          collectionId: data.collectionId,
          status: "DRAFT",
          translations: {
            create: LOCALES.filter((l) => data.names[l]).map((l) => ({ locale: l, name: data.names[l]! })),
          },
        },
      });
      await audit({ actor: admin.email, action: "product.create", entity: "Product", entityId: p.id, data: { slug: data.slug } }, tx);
      return p.id;
    });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") return fail("Такой slug уже занят");
    throw e;
  }
  revalidateAdmin();
  redirect(`/admin/products/${productId}`);
}

// ─────────────────────────────── Status ───────────────────────────────

export async function setProductStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("productCommerce", async (admin) => {
    const { data, error } = parse(z.object({ productId: id, status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]) }), {
      productId: s(fd, "productId"),
      status: s(fd, "status"),
    });
    if (error) return error;
    try {
      await db.$transaction(async (tx) => {
        const p = await tx.product.findUniqueOrThrow({
          where: { id: data.productId },
          select: { status: true, translations: { select: { locale: true, name: true } }, variants: { select: { isActive: true, priceAmd: true } } },
        });
        if (data.status === "ACTIVE") {
          const blockers = publishBlockers(p);
          if (blockers.length) throw new Refused(`Публикация невозможна: ${blockers.join("; ")}`);
        }
        await tx.product.update({ where: { id: data.productId }, data: { status: data.status } });
        await audit(
          { actor: admin.email, action: "product.status", entity: "Product", entityId: data.productId, data: { from: p.status, to: data.status } },
          tx,
        );
      });
    } catch (e) {
      const r = refusedToState(e);
      if (r) return r;
      throw e;
    }
    revalidateStore();
    return ok(data.status === "ACTIVE" ? "Опубликовано" : data.status === "ARCHIVED" ? "Перенесено в архив" : "Снято с публикации (черновик)");
  });
}

// ─────────────────────────────── Basics ───────────────────────────────

export async function saveProductBasics(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("productCommerce", async (admin) => {
    const { data, error } = parse(
      z.object({
        productId: id,
        slug: slugSchema,
        collectionId: id,
        isFeatured: z.boolean(),
        isBestseller: z.boolean(),
        isNew: z.boolean(),
        isGift: z.boolean(),
        sortOrder: reqInt(-100000, 100000),
      }),
      {
        productId: s(fd, "productId"),
        slug: s(fd, "slug"),
        collectionId: s(fd, "collectionId"),
        isFeatured: b(fd, "isFeatured"),
        isBestseller: b(fd, "isBestseller"),
        isNew: b(fd, "isNew"),
        isGift: b(fd, "isGift"),
        sortOrder: s(fd, "sortOrder") ?? "0",
      },
    );
    if (error) return error;
    const { productId, ...rest } = data;
    await db.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: rest });
      await audit({ actor: admin.email, action: "product.basics", entity: "Product", entityId: productId, data: rest }, tx);
    });
    revalidateStore();
    return ok();
  });
}

// ─────────────────────────────── Translations ───────────────────────────────

const TR_FIELDS = ["name", "scentDescriptor", "profileDescription", "officialDescription", "usage", "seoTitle", "seoDescription"] as const;
const TR_MAX: Record<(typeof TR_FIELDS)[number], number> = {
  name: 160,
  scentDescriptor: 200,
  profileDescription: 4000,
  officialDescription: 4000,
  usage: 2000,
  seoTitle: 70,
  seoDescription: 170,
};

export async function saveProductTranslations(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const productId = s(fd, "productId");
    if (!productId || productId.length > 40) return fail("Нет товара");
    const rowSchema = z.object(Object.fromEntries(TR_FIELDS.map((f) => [f, optText(TR_MAX[f])])) as Record<(typeof TR_FIELDS)[number], ReturnType<typeof optText>>);
    const rows: { locale: (typeof LOCALES)[number]; data: z.output<typeof rowSchema> }[] = [];
    for (const l of LOCALES) {
      const { data, error } = parse(rowSchema, Object.fromEntries(TR_FIELDS.map((f) => [f, s(fd, `${l}_${f}`)])));
      if (error) return fail(`${l.toUpperCase()}: ${error?.message}`);
      rows.push({ locale: l, data });
    }
    for (const r of rows) {
      const anyFilled = TR_FIELDS.some((f) => r.data[f]);
      if (anyFilled && !r.data.name) return fail(`${r.locale.toUpperCase()}: название обязательно, если заполнены другие поля`);
    }
    try {
      await db.$transaction(async (tx) => {
        for (const r of rows) {
          if (!r.data.name) {
            await tx.productTranslation.deleteMany({ where: { productId, locale: r.locale } });
            continue;
          }
          const values = { ...r.data, name: r.data.name };
          await tx.productTranslation.upsert({
            where: { productId_locale: { productId, locale: r.locale } },
            create: { productId, locale: r.locale, ...values },
            update: values,
          });
        }
        await guardPublished(tx, productId);
        await audit(
          {
            actor: admin.email,
            action: "product.translations",
            entity: "Product",
            entityId: productId,
            data: { locales: rows.filter((r) => r.data.name).map((r) => r.locale) },
          },
          tx,
        );
      });
    } catch (e) {
      const r = refusedToState(e);
      if (r) return r;
      throw e;
    }
    revalidateStore();
    return ok("Переводы сохранены");
  });
}

// ─────────────────────────────── Manufacturer facts ───────────────────────────────

const FACTS: { key: "articleNumber" | "ean" | "durationDays" | "dimensions" | "colorName" | "format"; field: FactField }[] = [
  { key: "articleNumber", field: "ARTICLE_NUMBER" },
  { key: "ean", field: "EAN" },
  { key: "durationDays", field: "DURATION" },
  { key: "dimensions", field: "DIMENSIONS" },
  { key: "colorName", field: "COLOR" },
  { key: "format", field: "FORMAT" },
];

const FACT_LABEL: Record<(typeof FACTS)[number]["key"], string> = {
  articleNumber: "Артикул",
  ean: "EAN",
  durationDays: "Срок действия",
  dimensions: "Размеры",
  colorName: "Цвет",
  format: "Формат",
};

const factValues = z.object({
  articleNumber: optText(40),
  ean: z
    .string()
    .refine(isValidEan, "EAN: нужно 8 или 13 цифр с верной контрольной цифрой")
    .nullable(),
  durationDays: optInt(1, 365),
  dimensions: optText(80),
  colorName: optText(60),
  format: z.enum(["VENT_CLIP", "HANGING", "BOTTLE", "PAPER", "OTHER"]).nullable(),
});

const factSource = z.object({
  sourceType: sourceEnum.nullable(),
  sourceUrl: optUrl,
  verification: verificationEnum,
  note: optText(500),
});

export async function saveProductFacts(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const productId = s(fd, "productId");
    if (!productId || productId.length > 40) return fail("Нет товара");
    const v = parse(factValues, Object.fromEntries(FACTS.map((f) => [f.key, s(fd, f.key)])));
    if (v.error) return v.error;
    const sources: Record<string, z.output<typeof factSource>> = {};
    for (const f of FACTS) {
      const r = parse(factSource, {
        sourceType: s(fd, `${f.key}_sourceType`),
        sourceUrl: s(fd, `${f.key}_sourceUrl`),
        verification: s(fd, `${f.key}_verification`) ?? "UNVERIFIED",
        note: s(fd, `${f.key}_note`),
      });
      if (r.error) return fail(`${FACT_LABEL[f.key]}: ${r.error.message}`);
      if (r.data.verification === "VERIFIED" && !r.data.sourceType) return fail(`${FACT_LABEL[f.key]}: для статуса «Подтверждено» нужен источник`);
      if (r.data.verification === "VERIFIED" && (v.data[f.key] === null || v.data[f.key] === undefined))
        return fail(`${FACT_LABEL[f.key]}: нельзя подтвердить пустое значение`);
      sources[f.key] = r.data;
    }

    await db.$transaction(async (tx) => {
      const existing = await tx.productFact.findMany({ where: { productId } });
      await tx.product.update({ where: { id: productId }, data: v.data });
      for (const f of FACTS) {
        const src = sources[f.key]!;
        const raw = v.data[f.key];
        const value = raw === null || raw === undefined ? null : String(raw);
        const prev = existing.find((e) => e.field === f.field);
        if (!src.sourceType) {
          // No source recorded: the value (if any) stays on the product as an
          // untraced entry; an old trace row is removed.
          if (prev) await tx.productFact.delete({ where: { id: prev.id } });
          continue;
        }
        const keepStamp =
          src.verification === "VERIFIED" &&
          prev?.verification === "VERIFIED" &&
          prev.value === value &&
          prev.sourceType === src.sourceType &&
          prev.sourceUrl === src.sourceUrl;
        const stamp =
          src.verification !== "VERIFIED"
            ? { verifiedAt: null, verifiedBy: null }
            : keepStamp
              ? { verifiedAt: prev!.verifiedAt, verifiedBy: prev!.verifiedBy }
              : { verifiedAt: new Date(), verifiedBy: admin.email };
        const row = { value, sourceType: src.sourceType, sourceUrl: src.sourceUrl, verification: src.verification, note: src.note, ...stamp };
        await tx.productFact.upsert({
          where: { productId_field: { productId, field: f.field } },
          create: { productId, field: f.field, ...row },
          update: row,
        });
      }
      await audit(
        { actor: admin.email, action: "product.facts", entity: "Product", entityId: productId, data: { values: v.data as Prisma.InputJsonValue, sources } },
        tx,
      );
    });
    revalidateStore();
    return ok("Факты производителя сохранены");
  });
}

// ─────────────────────────────── Scent metadata ───────────────────────────────

export async function saveProductScent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(
      z.object({
        productId: id,
        familyId: id.nullable(),
        tagIds: z.array(id).max(50),
        intensity: optInt(1, 5),
        sweetness: optInt(0, 5),
        freshness: optInt(0, 5),
        woodiness: optInt(0, 5),
        fruity: optInt(0, 5),
        floral: optInt(0, 5),
      }),
      {
        productId: s(fd, "productId"),
        familyId: s(fd, "familyId"),
        tagIds: list(fd, "tagIds"),
        intensity: s(fd, "intensity"),
        sweetness: s(fd, "sweetness"),
        freshness: s(fd, "freshness"),
        woodiness: s(fd, "woodiness"),
        fruity: s(fd, "fruity"),
        floral: s(fd, "floral"),
      },
    );
    if (error) return error;
    const { productId, tagIds, ...values } = data;
    await db.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: values });
      await tx.productScentTag.deleteMany({ where: { productId } });
      if (tagIds.length) await tx.productScentTag.createMany({ data: tagIds.map((tagId) => ({ productId, tagId })) });
      await audit({ actor: admin.email, action: "product.scent", entity: "Product", entityId: productId, data: { ...values, tagIds } }, tx);
    });
    revalidateStore();
    return ok("Профиль аромата сохранён");
  });
}

export async function saveProductAccent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(z.object({ productId: id, accentColor: optHex, accentInk: optHex }), {
      productId: s(fd, "productId"),
      accentColor: s(fd, "accentColor"),
      accentInk: s(fd, "accentInk"),
    });
    if (error) return error;
    const { productId, ...values } = data;
    await db.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: values });
      await audit({ actor: admin.email, action: "product.accent", entity: "Product", entityId: productId, data: values }, tx);
    });
    revalidateStore();
    return ok("Цвета сохранены");
  });
}

// ─────────────────────────────── Variants ───────────────────────────────

const variantSchema = z
  .object({
    sku: z
      .string({ error: "SKU обязателен" })
      .min(2, "SKU: минимум 2 символа")
      .max(60)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "SKU: латиница, цифры, точка, дефис, подчёркивание"),
    label: optText(80),
    priceAmd: optInt(0, 10_000_000),
    compareAtAmd: optInt(0, 10_000_000),
    priceIsDemo: z.boolean(),
    isActive: z.boolean(),
    isDefault: z.boolean(),
    lowStockAt: reqInt(0, 100000),
  })
  .refine((v) => v.compareAtAmd === null || (v.priceAmd !== null && v.compareAtAmd > v.priceAmd), {
    message: "Старая цена должна быть больше текущей",
    path: ["compareAtAmd"],
  });

function variantInput(fd: FormData) {
  return {
    sku: s(fd, "sku"),
    label: s(fd, "label"),
    priceAmd: s(fd, "priceAmd"),
    compareAtAmd: s(fd, "compareAtAmd"),
    priceIsDemo: b(fd, "priceIsDemo"),
    isActive: b(fd, "isActive"),
    isDefault: b(fd, "isDefault"),
    lowStockAt: s(fd, "lowStockAt") ?? "3",
  };
}

export async function saveVariant(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("productCommerce", async (admin) => {
    const variantId = s(fd, "variantId");
    const productId = s(fd, "productId");
    if (!variantId || !productId) return fail("Нет варианта");
    const { data, error } = parse(variantSchema, variantInput(fd));
    if (error) return error;
    try {
      await db.$transaction(async (tx) => {
        const v = await tx.variant.findFirst({ where: { id: variantId, productId } });
        if (!v) throw new Refused("Вариант не найден");
        if (data.isDefault) await tx.variant.updateMany({ where: { productId, id: { not: variantId } }, data: { isDefault: false } });
        await tx.variant.update({ where: { id: variantId }, data });
        await guardPublished(tx, productId);
        await audit({ actor: admin.email, action: "variant.update", entity: "Variant", entityId: variantId, data: { productId, ...data } }, tx);
      });
    } catch (e) {
      const r = refusedToState(e);
      if (r) return r;
      throw e;
    }
    revalidateStore();
    return ok("Вариант сохранён");
  });
}

export async function addVariant(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("productCommerce", async (admin) => {
    const productId = s(fd, "productId");
    if (!productId) return fail("Нет товара");
    const { data, error } = parse(variantSchema, variantInput(fd));
    if (error) return error;
    await db.$transaction(async (tx) => {
      const count = await tx.variant.count({ where: { productId } });
      const isDefault = data.isDefault || count === 0;
      if (isDefault) await tx.variant.updateMany({ where: { productId }, data: { isDefault: false } });
      // Stock always starts at 0 and only moves through the inventory ledger.
      const v = await tx.variant.create({ data: { ...data, isDefault, productId, stockOnHand: 0, reserved: 0 } });
      await audit({ actor: admin.email, action: "variant.create", entity: "Variant", entityId: v.id, data: { productId, ...data } }, tx);
    });
    revalidateStore();
    return ok("Вариант добавлен (остаток 0 — оприходуйте через склад)");
  });
}

// ─────────────────────────────── Inventory ───────────────────────────────

export async function adjustStock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("inventory", async (admin) => {
    const { data, error } = parse(
      z.object({
        variantId: id,
        delta: reqInt(-100000, 100000).refine((n) => n !== 0, "Изменение не может быть 0"),
        type: z.enum(["PURCHASE", "MANUAL_ADJUSTMENT", "RETURN_TO_STOCK", "REFUND"]),
        note: optText(300),
      }),
      { variantId: s(fd, "variantId"), delta: s(fd, "delta"), type: s(fd, "type"), note: s(fd, "note") },
    );
    if (error) return error;
    if (data.type === "PURCHASE" && data.delta < 0) return fail("Поступление может быть только положительным");
    if (data.type === "MANUAL_ADJUSTMENT" && !data.note) return fail("Для ручной корректировки укажите причину");
    let after: { stockOnHand: number; reserved: number };
    try {
      after = await db.$transaction(async (tx) => {
        const row = await adjust(tx, data.variantId, data.delta, data.type, `admin:${admin.email}`, data.note ?? undefined);
        await audit({ actor: admin.email, action: "inventory.adjust", entity: "Variant", entityId: data.variantId, data: { ...data, after: row } }, tx);
        return row;
      });
    } catch (e) {
      const r = refusedToState(e);
      if (r) return r;
      throw e;
    }
    revalidateStore();
    return ok(`Остаток: ${after.stockOnHand}, в резерве: ${after.reserved}`);
  });
}

// ─────────────────────────────── Media ───────────────────────────────

const mediaKind = z.enum(["PRODUCT", "PACKAGING", "INSTALLED", "DETAIL", "LIFESTYLE", "HERO"]);
const mediaRights = z.enum(["PLACEHOLDER", "AUTHORIZED", "UNCONFIRMED"]);
const alts = {
  altHy: optText(200),
  altRu: optText(200),
  altIt: optText(200),
  altEn: optText(200),
};
const altInput = (fd: FormData) => ({ altHy: s(fd, "altHy"), altRu: s(fd, "altRu"), altIt: s(fd, "altIt"), altEn: s(fd, "altEn") });

export async function addMedia(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(
      z.object({
        productId: id,
        url: z
          .string({ error: "Ссылка обязательна" })
          .max(500)
          .refine((u) => /^https:\/\/[^\s]+$/.test(u) || /^\/(?!\/)[^\s]*$/.test(u), "Ссылка: https://… или путь от корня сайта /…"),
        width: reqInt(1, 10000),
        height: reqInt(1, 10000),
        kind: mediaKind,
        rights: mediaRights,
        rightsNote: optText(300),
        ...alts,
      }),
      {
        productId: s(fd, "productId"),
        url: s(fd, "url"),
        width: s(fd, "width"),
        height: s(fd, "height"),
        kind: s(fd, "kind"),
        rights: s(fd, "rights"),
        rightsNote: s(fd, "rightsNote"),
        ...altInput(fd),
      },
    );
    if (error) return error;
    await db.$transaction(async (tx) => {
      const last = await tx.mediaAsset.aggregate({ where: { productId: data.productId }, _max: { sortOrder: true } });
      const m = await tx.mediaAsset.create({
        data: { ...data, storageKey: data.url, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
      await audit({ actor: admin.email, action: "media.create", entity: "MediaAsset", entityId: m.id, data }, tx);
    });
    revalidateStore();
    return ok("Изображение добавлено");
  });
}

export async function updateMedia(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(
      z.object({ mediaId: id, kind: mediaKind, rights: mediaRights, rightsNote: optText(300), ...alts }),
      { mediaId: s(fd, "mediaId"), kind: s(fd, "kind"), rights: s(fd, "rights"), rightsNote: s(fd, "rightsNote"), ...altInput(fd) },
    );
    if (error) return error;
    const { mediaId, ...values } = data;
    await db.$transaction(async (tx) => {
      await tx.mediaAsset.update({ where: { id: mediaId }, data: values });
      await audit({ actor: admin.email, action: "media.update", entity: "MediaAsset", entityId: mediaId, data: values }, tx);
    });
    revalidateStore();
    return ok();
  });
}

export async function moveMedia(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(z.object({ mediaId: id, dir: z.enum(["up", "down"]) }), { mediaId: s(fd, "mediaId"), dir: s(fd, "dir") });
    if (error) return error;
    await db.$transaction(async (tx) => {
      const m = await tx.mediaAsset.findUniqueOrThrow({ where: { id: data.mediaId } });
      const all = await tx.mediaAsset.findMany({ where: { productId: m.productId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
      const i = all.findIndex((x) => x.id === m.id);
      const j = data.dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= all.length) return;
      [all[i], all[j]] = [all[j]!, all[i]!];
      // Renumber densely so equal sortOrders from older data cannot stall a move.
      for (const [k, row] of all.entries()) if (row.sortOrder !== k) await tx.mediaAsset.update({ where: { id: row.id }, data: { sortOrder: k } });
      await audit({ actor: admin.email, action: "media.move", entity: "MediaAsset", entityId: m.id, data: { dir: data.dir } }, tx);
    });
    revalidateStore();
    return ok("Порядок изменён");
  });
}

export async function deleteMedia(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const mediaId = s(fd, "mediaId");
    if (!mediaId) return fail("Нет изображения");
    await db.$transaction(async (tx) => {
      const m = await tx.mediaAsset.delete({ where: { id: mediaId } });
      await audit({ actor: admin.email, action: "media.delete", entity: "MediaAsset", entityId: mediaId, data: { url: m.url, productId: m.productId } }, tx);
    });
    revalidateStore();
    return ok("Удалено");
  });
}
