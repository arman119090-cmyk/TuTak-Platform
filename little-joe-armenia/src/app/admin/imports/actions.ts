"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminAction, parse } from "@/lib/admin/action";
import { fail, ok, s, type ActionState } from "@/lib/admin/forms";

/**
 * Accept / reject only records the decision. Accepting does NOT write the
 * proposed value anywhere — the admin applies it by hand in the product
 * editor, so a verified fact is never overwritten automatically.
 */
export async function resolveImportReview(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("imports", async (admin) => {
    const { data, error } = parse(z.object({ reviewId: z.string().min(1).max(40), status: z.enum(["ACCEPTED", "REJECTED", "OPEN"]) }), {
      reviewId: s(fd, "reviewId"),
      status: s(fd, "status"),
    });
    if (error) return error;
    const updated = await db.$transaction(async (tx) => {
      const r = await tx.importReview.findUnique({ where: { id: data.reviewId } });
      if (!r) return null;
      await tx.importReview.update({
        where: { id: r.id },
        data: {
          status: data.status,
          resolvedBy: data.status === "OPEN" ? null : admin.email,
          resolvedAt: data.status === "OPEN" ? null : new Date(),
        },
      });
      await audit({ actor: admin.email, action: "import_review.resolve", entity: "ImportReview", entityId: r.id, data: { from: r.status, to: data.status } }, tx);
      return r;
    });
    if (!updated) return fail("Запись не найдена");
    return ok(
      data.status === "ACCEPTED"
        ? "Принято. Данные НЕ применены автоматически — внесите изменение вручную в карточке товара."
        : data.status === "REJECTED"
          ? "Отклонено"
          : "Возвращено в открытые",
    );
  });
}
