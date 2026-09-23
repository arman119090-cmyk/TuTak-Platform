"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminAction, parse } from "@/lib/admin/action";
import { b, fail, ok, optHex, optText, reqInt, reqText, s, type ActionState } from "@/lib/admin/forms";
import { revalidateStore } from "@/lib/admin/revalidate";

const blockSchema = z.object({
  kind: z.enum(["HERO", "CAMPAIGN"]),
  sortOrder: reqInt(-10000, 10000),
  isActive: z.boolean(),
  href: z
    .string()
    .max(300)
    .refine((h) => h.startsWith("/") && !h.startsWith("//"), "Ссылка должна начинаться с «/» (внутренний адрес сайта)")
    .nullable(),
  accentColor: optHex,
  titleHy: reqText(160, "Заголовок HY"),
  titleRu: reqText(160, "Заголовок RU"),
  titleIt: reqText(160, "Заголовок IT"),
  titleEn: reqText(160, "Заголовок EN"),
  bodyHy: optText(1000),
  bodyRu: optText(1000),
  bodyIt: optText(1000),
  bodyEn: optText(1000),
});

function input(fd: FormData) {
  const keys = ["kind", "sortOrder", "href", "accentColor", "titleHy", "titleRu", "titleIt", "titleEn", "bodyHy", "bodyRu", "bodyIt", "bodyEn"];
  return { ...Object.fromEntries(keys.map((k) => [k, s(fd, k)])), sortOrder: s(fd, "sortOrder") ?? "0", isActive: b(fd, "isActive") };
}

export async function saveHomeBlock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("cms", async (admin) => {
    const blockId = s(fd, "blockId");
    const { data, error } = parse(blockSchema, input(fd));
    if (error) return error;
    await db.$transaction(async (tx) => {
      const row = blockId ? await tx.homeBlock.update({ where: { id: blockId }, data }) : await tx.homeBlock.create({ data });
      await audit({ actor: admin.email, action: blockId ? "home.block.update" : "home.block.create", entity: "HomeBlock", entityId: row.id, data }, tx);
    });
    revalidateStore();
    return ok(blockId ? "Блок сохранён" : "Блок добавлен");
  });
}

export async function deleteHomeBlock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("cms", async (admin) => {
    const blockId = s(fd, "blockId");
    if (!blockId) return fail("Нет блока");
    await db.$transaction(async (tx) => {
      await tx.homeBlock.delete({ where: { id: blockId } });
      await audit({ actor: admin.email, action: "home.block.delete", entity: "HomeBlock", entityId: blockId }, tx);
    });
    revalidateStore();
    return ok("Удалено");
  });
}

export async function addFeatured(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("cms", async (admin) => {
    const productId = s(fd, "productId");
    if (!productId) return fail("Выберите товар");
    await db.$transaction(async (tx) => {
      const last = await tx.homeFeaturedProduct.aggregate({ _max: { sortOrder: true } });
      await tx.homeFeaturedProduct.upsert({
        where: { productId },
        create: { productId, sortOrder: (last._max.sortOrder ?? -1) + 1 },
        update: {},
      });
      await audit({ actor: admin.email, action: "home.featured.add", entity: "HomeFeaturedProduct", entityId: productId }, tx);
    });
    revalidateStore();
    return ok("Добавлено");
  });
}

export async function moveFeatured(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("cms", async (admin) => {
    const productId = s(fd, "productId");
    const op = s(fd, "op");
    if (!productId || !op || !["up", "down", "remove"].includes(op)) return fail("Некорректный запрос");
    await db.$transaction(async (tx) => {
      const all = await tx.homeFeaturedProduct.findMany({ orderBy: [{ sortOrder: "asc" }, { productId: "asc" }] });
      const i = all.findIndex((x) => x.productId === productId);
      if (i < 0) return;
      if (op === "remove") {
        await tx.homeFeaturedProduct.delete({ where: { productId } });
        all.splice(i, 1);
      } else {
        const j = op === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= all.length) return;
        [all[i], all[j]] = [all[j]!, all[i]!];
      }
      for (const [k, row] of all.entries()) if (row.sortOrder !== k) await tx.homeFeaturedProduct.update({ where: { productId: row.productId }, data: { sortOrder: k } });
      await audit({ actor: admin.email, action: `home.featured.${op}`, entity: "HomeFeaturedProduct", entityId: productId }, tx);
    });
    revalidateStore();
    return ok(op === "remove" ? "Убрано" : "Порядок изменён");
  });
}
