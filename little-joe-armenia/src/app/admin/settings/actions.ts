"use server";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { REGION_CODES } from "@/lib/armenia";
import { settingSchemas, type SettingKey } from "@/lib/settings";
import { adminAction, parse } from "@/lib/admin/action";
import { b, fail, list, ok, optInt, optText, reqInt, reqText, s, type ActionState } from "@/lib/admin/forms";
import { revalidateStore } from "@/lib/admin/revalidate";

// Everything here is OWNER-only ("settings" area).

const deliverySchema = z.object({
  code: z
    .string({ error: "Код обязателен" })
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Код: a-z, 0-9, дефисы"),
  isActive: z.boolean(),
  sortOrder: reqInt(-10000, 10000),
  priceAmd: reqInt(0, 1_000_000),
  freeFromAmd: optInt(0, 10_000_000),
  regions: z.array(z.enum(REGION_CODES)).max(REGION_CODES.length),
  nameHy: reqText(120, "Название HY"),
  nameRu: reqText(120, "Название RU"),
  nameIt: reqText(120, "Название IT"),
  nameEn: reqText(120, "Название EN"),
  etaHy: optText(120),
  etaRu: optText(120),
  etaIt: optText(120),
  etaEn: optText(120),
});

export async function saveDeliveryMethod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("settings", async (admin) => {
    const methodId = s(fd, "methodId");
    const text = ["code", "nameHy", "nameRu", "nameIt", "nameEn", "etaHy", "etaRu", "etaIt", "etaEn"];
    const { data, error } = parse(deliverySchema, {
      ...Object.fromEntries(text.map((k) => [k, s(fd, k)])),
      isActive: b(fd, "isActive"),
      sortOrder: s(fd, "sortOrder") ?? "0",
      priceAmd: s(fd, "priceAmd"),
      freeFromAmd: s(fd, "freeFromAmd"),
      regions: list(fd, "regions"),
    });
    if (error) return error;
    await db.$transaction(async (tx) => {
      const row = methodId ? await tx.deliveryMethod.update({ where: { id: methodId }, data }) : await tx.deliveryMethod.create({ data });
      await audit({ actor: admin.email, action: methodId ? "delivery.update" : "delivery.create", entity: "DeliveryMethod", entityId: row.id, data }, tx);
    });
    revalidateStore();
    return ok(methodId ? "Способ доставки сохранён" : "Способ доставки добавлен");
  });
}

export async function deleteDeliveryMethod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("settings", async (admin) => {
    const methodId = s(fd, "methodId");
    if (!methodId) return fail("Нет способа доставки");
    // Orders keep a snapshot (code + name), so deleting is safe for history.
    await db.$transaction(async (tx) => {
      const m = await tx.deliveryMethod.delete({ where: { id: methodId } });
      await audit({ actor: admin.email, action: "delivery.delete", entity: "DeliveryMethod", entityId: methodId, data: { code: m.code } }, tx);
    });
    revalidateStore();
    return ok("Удалено");
  });
}

export async function savePaymentMethod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("settings", async (admin) => {
    const { data, error } = parse(
      z.object({ provider: z.enum(["CASH_ON_DELIVERY", "IDRAM", "TELCELL", "BANK_CARD"]), isEnabled: z.boolean(), sortOrder: reqInt(-1000, 1000) }),
      { provider: s(fd, "provider"), isEnabled: b(fd, "isEnabled"), sortOrder: s(fd, "sortOrder") ?? "0" },
    );
    if (error) return error;
    await db.$transaction(async (tx) => {
      await tx.paymentMethodSetting.upsert({
        where: { provider: data.provider },
        create: data,
        update: { isEnabled: data.isEnabled, sortOrder: data.sortOrder },
      });
      await audit({ actor: admin.email, action: "payment_method.update", entity: "PaymentMethodSetting", entityId: data.provider, data }, tx);
    });
    revalidateStore();
    return ok(data.isEnabled ? "Включено" : "Выключено");
  });
}

const KEYS = Object.keys(settingSchemas) as SettingKey[];

export async function saveSetting(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("settings", async (admin) => {
    const key = KEYS.find((k) => k === s(fd, "key"));
    if (!key) return fail("Неизвестная настройка");
    const schema = settingSchemas[key];
    const raw: Record<string, unknown> = {};
    for (const [field, def] of Object.entries(schema.shape)) {
      // Booleans come from checkboxes; strings keep "" (the schema defaults allow it).
      const isBool = (def as z.ZodType).safeParse(true).success && !(def as z.ZodType).safeParse("x").success;
      if (isBool) raw[field] = b(fd, field);
      else {
        const v = fd.get(field);
        raw[field] = typeof v === "string" ? v.trim() : "";
      }
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return fail(`${i?.path.join(".")}: ${i?.message}`);
    }
    const value = parsed.data as Prisma.InputJsonValue;
    await db.$transaction(async (tx) => {
      const prev = await tx.setting.findUnique({ where: { key } });
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      await audit({ actor: admin.email, action: "setting.update", entity: "Setting", entityId: key, data: { from: prev?.value ?? null, to: value } }, tx);
    });
    revalidateStore();
    return ok();
  });
}
