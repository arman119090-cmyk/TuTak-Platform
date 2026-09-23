"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminTransition, LatePaymentStockError, TransitionError } from "@/lib/domain/orders";
import { InsufficientStockError } from "@/lib/domain/inventory";
import { ORDER_STATUSES } from "@/lib/domain/order-state";
import { adminAction, parse } from "@/lib/admin/action";
import { fail, ok, optText, s, type ActionState } from "@/lib/admin/forms";
import { ORDER_STATUS_LABEL } from "@/lib/admin/format";
import { revalidateStore } from "@/lib/admin/revalidate";

export async function transitionOrderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("orders", async (admin) => {
    const { data, error } = parse(
      z.object({ orderId: z.string().min(1).max(40), to: z.enum(ORDER_STATUSES), note: optText(500) }),
      { orderId: s(fd, "orderId"), to: s(fd, "to"), note: s(fd, "note") },
    );
    if (error) return error;
    try {
      // The state machine decides: admin can never set PAID / PAYMENT_FAILED.
      await adminTransition(data.orderId, data.to, admin.email, data.note ?? undefined);
    } catch (e) {
      if (e instanceof TransitionError) {
        return fail(
          `Переход «${ORDER_STATUS_LABEL[e.from] ?? e.from}» → «${ORDER_STATUS_LABEL[e.to] ?? e.to}» запрещён. Возможно, статус уже изменился — обновите страницу.`,
        );
      }
      if (e instanceof InsufficientStockError) return fail("Недостаточно товара на складе для этого перехода.");
      if (e instanceof LatePaymentStockError) return fail("Товара уже нет на складе — нужно решить вручную (связаться с покупателем, возврат).");
      throw e;
    }
    revalidateStore();
    return ok(`Статус: ${ORDER_STATUS_LABEL[data.to]}`);
  });
}

export async function addOrderNote(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return adminAction("orders", async (admin) => {
    const { data, error } = parse(
      z.object({ orderId: z.string().min(1).max(40), body: z.string({ error: "Текст заметки пуст" }).min(1, "Текст заметки пуст").max(2000) }),
      { orderId: s(fd, "orderId"), body: s(fd, "body") },
    );
    if (error) return error;
    await db.$transaction(async (tx) => {
      const note = await tx.orderNote.create({ data: { orderId: data.orderId, author: admin.email, body: data.body } });
      await audit({ actor: admin.email, action: "order.note", entity: "Order", entityId: data.orderId, data: { noteId: note.id } }, tx);
    });
    return ok("Заметка добавлена");
  });
}
