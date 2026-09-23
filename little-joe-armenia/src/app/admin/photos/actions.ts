"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminAction, parse } from "@/lib/admin/action";
import type { ActionState } from "@/lib/admin/forms";
import { revalidateStore } from "@/lib/admin/revalidate";

// Photo manager (/admin/photos): everything about a product's photos on one
// screen — add (becomes MAIN: shown on cards, the home page and first in the
// gallery), make another photo main, reorder, delete. Files are stored by
// /api/admin/upload first; these actions only touch MediaAsset rows.

const addSchema = z.object({
  productId: z.string().min(1).max(40),
  url: z.string().max(500).regex(/^\/media\/blob\/products\/[A-Za-z0-9/._-]+$|^https:\/\/[^\s]+$/, "Некорректная ссылка"),
  storageKey: z.string().max(300).regex(/^products\/[A-Za-z0-9/._-]+$/).refine((k) => !k.includes("..")),
  width: z.coerce.number().int().min(1).max(10000),
  height: z.coerce.number().int().min(1).max(10000),
});

export async function setMainPhoto(input: z.input<typeof addSchema>): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(addSchema, input);
    if (error) return error;
    const product = await db.product.findUnique({ where: { id: data.productId }, select: { id: true } });
    if (!product) return { ok: false, message: "Товар не найден" };
    const media = await db.$transaction(async (tx) => {
      const first = await tx.mediaAsset.aggregate({ where: { productId: product.id }, _min: { sortOrder: true } });
      const created = await tx.mediaAsset.create({
        data: {
          productId: product.id,
          kind: "PRODUCT",
          url: data.url,
          storageKey: data.storageKey,
          width: data.width,
          height: data.height,
          // Uploaded by the store owner/staff in the admin.
          rights: "AUTHORIZED",
          rightsNote: `Загружено в админке: ${admin.email}`,
          sortOrder: (first._min.sortOrder ?? 1) - 1,
        },
      });
      await audit({ actor: admin.email, action: "media.set_main", entity: "Product", entityId: product.id, data: { url: data.url } }, tx);
      return created;
    });
    revalidateStore();
    return { ok: true, message: `Фото добавлено (${media.width}×${media.height})` };
  });
}

const mediaId = z.string().min(1).max(40);

/** Moves an existing photo to the front: it becomes the product's main photo. */
export async function makeMainPhoto(id: string): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(mediaId, id);
    if (error) return error;
    const done = await db.$transaction(async (tx) => {
      const m = await tx.mediaAsset.findUnique({ where: { id: data }, select: { id: true, productId: true } });
      if (!m?.productId) return false;
      const first = await tx.mediaAsset.aggregate({ where: { productId: m.productId }, _min: { sortOrder: true } });
      await tx.mediaAsset.update({ where: { id: m.id }, data: { sortOrder: (first._min.sortOrder ?? 1) - 1 } });
      await audit({ actor: admin.email, action: "media.make_main", entity: "MediaAsset", entityId: m.id, data: { productId: m.productId } }, tx);
      return true;
    });
    if (!done) return { ok: false, message: "Фото не найдено — обновите страницу" };
    revalidateStore();
    return { ok: true, message: "Теперь это главное фото" };
  });
}

/** Swaps a photo with its neighbour (left = earlier in the gallery). */
export async function movePhoto(id: string, dir: "left" | "right"): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(z.object({ id: mediaId, dir: z.enum(["left", "right"]) }), { id, dir });
    if (error) return error;
    const done = await db.$transaction(async (tx) => {
      const m = await tx.mediaAsset.findUnique({ where: { id: data.id }, select: { id: true, productId: true } });
      if (!m?.productId) return false;
      const all = await tx.mediaAsset.findMany({ where: { productId: m.productId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, sortOrder: true } });
      const i = all.findIndex((x) => x.id === m.id);
      const j = data.dir === "left" ? i - 1 : i + 1;
      if (j < 0 || j >= all.length) return true;
      [all[i], all[j]] = [all[j]!, all[i]!];
      // Renumber densely so equal sortOrders from older data cannot stall a move.
      for (const [k, row] of all.entries()) if (row.sortOrder !== k) await tx.mediaAsset.update({ where: { id: row.id }, data: { sortOrder: k } });
      await audit({ actor: admin.email, action: "media.move", entity: "MediaAsset", entityId: m.id, data: { dir: data.dir } }, tx);
      return true;
    });
    if (!done) return { ok: false, message: "Фото не найдено — обновите страницу" };
    revalidateStore();
    return { ok: true, message: "Порядок изменён" };
  });
}

/** Deletes a photo; a file uploaded into the database is freed when nothing else uses it. */
export async function deletePhoto(id: string): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(mediaId, id);
    if (error) return error;
    const done = await db.$transaction(async (tx) => {
      const m = await tx.mediaAsset.findUnique({ where: { id: data } });
      if (!m) return false;
      await tx.mediaAsset.delete({ where: { id: m.id } });
      if (m.storageKey && m.url.startsWith("/media/blob/")) {
        const stillUsed = await tx.mediaAsset.count({ where: { storageKey: m.storageKey } });
        if (!stillUsed) await tx.mediaBlob.deleteMany({ where: { key: m.storageKey } });
      }
      await audit({ actor: admin.email, action: "media.delete", entity: "MediaAsset", entityId: m.id, data: { url: m.url, productId: m.productId } }, tx);
      return true;
    });
    if (!done) return { ok: false, message: "Фото уже удалено — обновите страницу" };
    revalidateStore();
    return { ok: true, message: "Фото удалено" };
  });
}
