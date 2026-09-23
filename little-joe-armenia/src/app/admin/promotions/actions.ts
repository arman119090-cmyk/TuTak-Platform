"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizePromoCode } from "@/lib/domain/pricing";
import { adminAction, parse } from "@/lib/admin/action";
import { requireAdmin } from "@/lib/admin/auth";
import { b, fail, isUniqueViolation, list, ok, optInt, parseYerevanLocal, reqInt, s, type ActionState } from "@/lib/admin/forms";
import { revalidateAdmin, revalidateStore } from "@/lib/admin/revalidate";

const schema = z
  .object({
    code: z
      .string({ error: "Код обязателен" })
      .min(3, "Код: минимум 3 символа")
      .max(40)
      .regex(/^[A-Z0-9_-]+$/, "Код: латиница, цифры, дефис, подчёркивание"),
    name: z.string({ error: "Название обязательно" }).min(1, "Название обязательно").max(120),
    type: z.enum(["PERCENT", "FIXED"]),
    value: reqInt(1, 10_000_000),
    startsAt: z.date().nullable(),
    endsAt: z.date().nullable(),
    minSubtotalAmd: optInt(0, 10_000_000),
    usageLimit: optInt(1, 1_000_000),
    isActive: z.boolean(),
    productIds: z.array(z.string().min(1).max(40)).max(500),
    collectionIds: z.array(z.string().min(1).max(40)).max(100),
  })
  .refine((p) => p.type !== "PERCENT" || p.value <= 100, { message: "Процент: от 1 до 100", path: ["value"] })
  .refine((p) => !p.startsAt || !p.endsAt || p.endsAt > p.startsAt, { message: "Окончание должно быть позже начала", path: ["endsAt"] });

function input(fd: FormData) {
  const code = s(fd, "code");
  const startsRaw = s(fd, "startsAt");
  const endsRaw = s(fd, "endsAt");
  return {
    raw: { startsRaw, endsRaw },
    data: {
      code: code ? normalizePromoCode(code) : null,
      name: s(fd, "name"),
      type: s(fd, "type"),
      value: s(fd, "value"),
      startsAt: parseYerevanLocal(startsRaw),
      endsAt: parseYerevanLocal(endsRaw),
      minSubtotalAmd: s(fd, "minSubtotalAmd"),
      usageLimit: s(fd, "usageLimit"),
      isActive: b(fd, "isActive"),
      productIds: list(fd, "productIds"),
      collectionIds: list(fd, "collectionIds"),
    },
  };
}

function validate(fd: FormData) {
  const { raw, data } = input(fd);
  if (raw.startsRaw && !data.startsAt) return { data: null, error: { ok: false as const, message: "Некорректная дата начала" } };
  if (raw.endsRaw && !data.endsAt) return { data: null, error: { ok: false as const, message: "Некорректная дата окончания" } };
  return parse(schema, data);
}

export async function createPromotion(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin("promotions");
  const { data, error } = validate(fd);
  if (error) return error;
  let newId: string;
  try {
    newId = await db.$transaction(async (tx) => {
      const { productIds, collectionIds, ...fields } = data;
      const p = await tx.promotion.create({
        data: {
          ...fields,
          products: { create: productIds.map((productId) => ({ productId })) },
          collections: { create: collectionIds.map((collectionId) => ({ collectionId })) },
        },
      });
      await audit({ actor: admin.email, action: "promotion.create", entity: "Promotion", entityId: p.id, data: { ...fields, productIds, collectionIds } }, tx);
      return p.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("Промокод с таким кодом уже есть");
    throw e;
  }
  revalidateAdmin();
  revalidateStore();
  redirect(`/admin/promotions/${newId}`);
}

export async function savePromotion(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("promotions", async (admin) => {
    const promotionId = s(fd, "promotionId");
    if (!promotionId) return fail("Нет промокода");
    const { data, error } = validate(fd);
    if (error) return error;
    await db.$transaction(async (tx) => {
      const { productIds, collectionIds, ...fields } = data;
      await tx.promotion.update({ where: { id: promotionId }, data: fields });
      await tx.promotionProduct.deleteMany({ where: { promotionId } });
      await tx.promotionCollection.deleteMany({ where: { promotionId } });
      if (productIds.length) await tx.promotionProduct.createMany({ data: productIds.map((productId) => ({ promotionId, productId })) });
      if (collectionIds.length) await tx.promotionCollection.createMany({ data: collectionIds.map((collectionId) => ({ promotionId, collectionId })) });
      await audit({ actor: admin.email, action: "promotion.update", entity: "Promotion", entityId: promotionId, data: { ...fields, productIds, collectionIds } }, tx);
    });
    revalidateStore();
    return ok();
  });
}

export async function deletePromotion(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin("promotions");
  const promotionId = s(fd, "promotionId");
  if (!promotionId) return fail("Нет промокода");
  const used = await db.promotionRedemption.count({ where: { promotionId } });
  if (used > 0) return fail(`Промокод уже использован в ${used} заказ(ах) — удалить нельзя, выключите его.`);
  await db.$transaction(async (tx) => {
    const p = await tx.promotion.delete({ where: { id: promotionId } });
    await audit({ actor: admin.email, action: "promotion.delete", entity: "Promotion", entityId: promotionId, data: { code: p.code } }, tx);
  });
  revalidateAdmin();
  revalidateStore();
  redirect("/admin/promotions");
}
