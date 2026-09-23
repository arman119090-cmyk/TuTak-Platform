"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminAction, parse } from "@/lib/admin/action";
import type { ActionState } from "@/lib/admin/forms";
import { revalidateStore } from "@/lib/admin/revalidate";

// Quick photo manager: an uploaded file (already stored by
// /api/admin/upload) becomes the product's MAIN photo — the one shown on
// cards, the home page and first in the product gallery. Older photos stay
// in the gallery behind it (manage/delete them in the product editor).

const schema = z.object({
  productId: z.string().min(1).max(40),
  url: z.string().max(500).regex(/^\/media\/blob\/products\/[A-Za-z0-9/._-]+$|^https:\/\/[^\s]+$/, "Некорректная ссылка"),
  storageKey: z.string().max(300).regex(/^products\/[A-Za-z0-9/._-]+$/).refine((k) => !k.includes("..")),
  width: z.coerce.number().int().min(1).max(10000),
  height: z.coerce.number().int().min(1).max(10000),
});

export async function setMainPhoto(input: z.input<typeof schema>): Promise<ActionState> {
  return adminAction("products", async (admin) => {
    const { data, error } = parse(schema, input);
    if (error) return error;
    const product = await db.product.findUnique({ where: { id: data.productId }, select: { id: true, slug: true } });
    if (!product) return { ok: false, message: "Товар не найден" };
    const first = await db.mediaAsset.aggregate({ where: { productId: product.id }, _min: { sortOrder: true } });
    const media = await db.$transaction(async (tx) => {
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
    return { ok: true, message: `Главное фото обновлено (${media.width}×${media.height})` };
  });
}
