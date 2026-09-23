import "server-only";
import type { PaymentProviderCode } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createMockAdapter } from "@/lib/payments/adapters/mock";
import { idramAdapter } from "@/lib/payments/adapters/idram";
import { cardAdapter, telcellAdapter } from "@/lib/payments/adapters/pending";
import type { PaymentAdapter } from "@/lib/payments/types";

export const ONLINE_PROVIDERS = ["IDRAM", "TELCELL", "BANK_CARD"] as const satisfies PaymentProviderCode[];

const live: Record<(typeof ONLINE_PROVIDERS)[number], PaymentAdapter> = {
  IDRAM: idramAdapter,
  TELCELL: telcellAdapter,
  BANK_CARD: cardAdapter,
};

/** Adapter that will process a payment for this provider, or null. */
export function adapterFor(provider: PaymentProviderCode): PaymentAdapter | null {
  if (provider === "CASH_ON_DELIVERY") return null;
  if (env().PAYMENTS_MODE === "mock") return createMockAdapter(provider);
  const a = live[provider];
  return a.isConfigured() ? a : null;
}

/** Adapter by the id used in callback URLs. */
export function adapterById(id: string): PaymentAdapter | null {
  if (id === "mock") return env().PAYMENTS_MODE === "mock" ? createMockAdapter("BANK_CARD") : null;
  const a = Object.values(live).find((x) => x.id === id);
  return a && a.isConfigured() ? a : null;
}

/**
 * Payment methods offered at checkout: enabled by the admin AND technically
 * available (COD always is; online methods need an adapter).
 */
export async function availablePaymentMethods(): Promise<PaymentProviderCode[]> {
  const settings = await db.paymentMethodSetting.findMany({ where: { isEnabled: true }, orderBy: { sortOrder: "asc" } });
  return settings
    .map((s) => s.provider)
    .filter((p) => p === "CASH_ON_DELIVERY" || adapterFor(p) !== null);
}
