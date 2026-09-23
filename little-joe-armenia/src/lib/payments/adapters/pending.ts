import "server-only";
import type { PaymentProviderCode } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { PaymentNotAvailableError, type PaymentAdapter } from "@/lib/payments/types";

// Telcell and bank-card acquiring adapters.
//
// The public contract (credentials, request signing, callback format) for
// both is only issued with a merchant agreement, so these adapters are
// deliberately NOT implemented against guessed specifications. They report
// themselves as not configured, which hides them from checkout in live mode.
// In mock mode the sandbox adapter stands in for them.
//
// To implement: fill start() and parseCallback() per the provider's docs;
// nothing else in the checkout, order or webhook pipeline has to change.

function pendingAdapter(id: string, provider: PaymentProviderCode): PaymentAdapter {
  return {
    id,
    provider,
    // Stays unavailable even when credentials are present: credentials
    // alone must never enable an unwritten integration.
    isConfigured: () => false,
    async start() {
      throw new PaymentNotAvailableError(provider);
    },
    async parseCallback() {
      return { kind: "invalid", reason: `${id} adapter not implemented` };
    },
    ack() {
      return new Response("Not implemented", { status: 501 });
    },
  };
}

export const telcellAdapter = pendingAdapter("telcell", "TELCELL");
export const cardAdapter = pendingAdapter("card", "BANK_CARD");

/** Shown in admin settings so the owner sees what is still missing. */
export function credentialStatus() {
  const e = env();
  return {
    IDRAM: Boolean(e.IDRAM_REC_ACCOUNT && e.IDRAM_SECRET_KEY),
    TELCELL: Boolean(e.TELCELL_SHOP_ID && e.TELCELL_SHOP_KEY),
    BANK_CARD: Boolean(e.CARD_ACQUIRER_API_URL && e.CARD_ACQUIRER_USERNAME && e.CARD_ACQUIRER_PASSWORD),
  };
}
