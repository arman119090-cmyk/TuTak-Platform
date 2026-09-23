"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale } from "@/i18n/config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { paths } from "@/lib/paths";
import { randomToken } from "@/lib/security/crypto";
import { signMockBody, type MockCallbackBody } from "@/lib/payments/adapters/mock";
import { handleCallback } from "@/lib/payments/service";
import { orderAccessToken } from "@/lib/domain/checkout";

/**
 * Sandbox "provider": builds a signed notification exactly as an external
 * provider would and hands it to the same callback pipeline the real
 * /api/payments/callback/mock route uses. Only available in mock mode.
 */
export async function mockCompleteAction(form: FormData) {
  if (env().PAYMENTS_MODE !== "mock") throw new Error("Sandbox disabled");
  const input = z
    .object({ paymentId: z.string().min(1).max(40), outcome: z.enum(["SUCCEEDED", "FAILED"]), locale: z.string().refine(isLocale) })
    .parse(Object.fromEntries(form));
  const payment = await db.payment.findUnique({ where: { id: input.paymentId }, include: { order: true } });
  if (!payment || payment.adapter !== "mock") throw new Error("Unknown payment");

  const body: MockCallbackBody = {
    eventId: `evt_${randomToken(12)}`,
    paymentId: payment.id,
    outcome: input.outcome,
    amountAmd: payment.amountAmd,
    providerRef: `mock_${randomToken(6)}`,
  };
  const raw = JSON.stringify(body);
  const request = new Request(new URL("/api/payments/callback/mock", env().APP_URL), {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-signature": signMockBody(raw) },
    body: raw,
  });
  await handleCallback("mock", request);
  const locale = input.locale as "hy";
  redirect(paths.order(locale, payment.order.number, orderAccessToken(payment.order.idempotencyKey)));
}
