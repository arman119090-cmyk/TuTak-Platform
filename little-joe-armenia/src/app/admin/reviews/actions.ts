"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminAction, parse } from "@/lib/admin/action";
import { ok, s, type ActionState } from "@/lib/admin/forms";
import { revalidateStore } from "@/lib/admin/revalidate";

export async function moderateReview(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("reviews", async (admin) => {
    const { data, error } = parse(z.object({ reviewId: z.string().min(1).max(40), status: z.enum(["APPROVED", "REJECTED", "PENDING"]) }), {
      reviewId: s(fd, "reviewId"),
      status: s(fd, "status"),
    });
    if (error) return error;
    await db.$transaction(async (tx) => {
      const r = await tx.review.update({
        where: { id: data.reviewId },
        data: {
          status: data.status,
          moderatedAt: data.status === "PENDING" ? null : new Date(),
          moderatedBy: data.status === "PENDING" ? null : admin.email,
        },
      });
      await audit({ actor: admin.email, action: "review.moderate", entity: "Review", entityId: r.id, data: { status: data.status, productId: r.productId } }, tx);
    });
    revalidateStore();
    return ok(data.status === "APPROVED" ? "Одобрен" : data.status === "REJECTED" ? "Отклонён" : "Возвращён в очередь");
  });
}
