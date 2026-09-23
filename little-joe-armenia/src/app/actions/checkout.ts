"use server";

import { isLocale, type Locale } from "@/i18n/config";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { shopper } from "@/lib/security/session";
import { checkoutSchema } from "@/lib/validation/checkout";
import { placeOrder } from "@/lib/domain/checkout";
import { expireReservations } from "@/lib/domain/orders";
import { startPayment } from "@/lib/payments/service";
import { PaymentNotAvailableError, type PaymentStart } from "@/lib/payments/types";
import { paths } from "@/lib/paths";
import { db } from "@/lib/db";
import { canRetryPayment } from "@/lib/payments/service";
import { findOrderForViewer } from "@/lib/domain/checkout";
import { transitionOrder, TransitionError } from "@/lib/domain/orders";
import { InsufficientStockError } from "@/lib/domain/inventory";

export type CheckoutResult =
  | { ok: true; next: { kind: "navigate"; url: string } | { kind: "payment"; start: PaymentStart; orderUrl: string } }
  | { ok: false; error: string; fields?: Record<string, string> };

export async function placeOrderAction(locale: string, input: unknown): Promise<CheckoutResult> {
  if (!isLocale(locale)) return { ok: false, error: "INVALID" };
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[String(i.path[0])] ??= i.message;
    return { ok: false, error: "VALIDATION", fields };
  }
  const limit = await rateLimit("checkout", await clientIp());
  if (!limit.ok) return { ok: false, error: "RATE_LIMITED" };

  // Lazy maintenance: free stock held by abandoned online payments first.
  await expireReservations().catch(() => undefined);

  const owner = await shopper();
  const result = await placeOrder(owner, parsed.data, locale as Locale);
  if (!result.ok) return { ok: false, error: result.error };

  const orderUrl = paths.order(locale as Locale, result.number, result.accessToken);
  if (!result.online || result.existing) return { ok: true, next: { kind: "navigate", url: orderUrl } };
  try {
    const start = await startPayment(result.orderId, locale as Locale);
    return { ok: true, next: { kind: "payment", start, orderUrl } };
  } catch (e) {
    if (e instanceof PaymentNotAvailableError) return { ok: true, next: { kind: "navigate", url: orderUrl } };
    throw e;
  }
}

/** Retry an online payment after a failure: stock is re-reserved first. */
export async function retryPaymentAction(locale: string, number: string, token: string): Promise<CheckoutResult> {
  if (!isLocale(locale)) return { ok: false, error: "INVALID" };
  const limit = await rateLimit("checkout", await clientIp());
  if (!limit.ok) return { ok: false, error: "RATE_LIMITED" };
  const order = await findOrderForViewer(number, token || undefined, await shopper());
  if (!order || !canRetryPayment(order)) return { ok: false, error: "INVALID" };
  try {
    await db.$transaction((tx) =>
      transitionOrder(tx, order.id, "AWAITING_PAYMENT", { kind: "system", name: "customer-retry" }, { paymentStatus: "PENDING" }),
    );
  } catch (e) {
    if (e instanceof InsufficientStockError) return { ok: false, error: "OUT_OF_STOCK" };
    if (e instanceof TransitionError) return { ok: false, error: "INVALID" };
    throw e;
  }
  const start = await startPayment(order.id, locale);
  return { ok: true, next: { kind: "payment", start, orderUrl: paths.order(locale, number, token) } };
}
