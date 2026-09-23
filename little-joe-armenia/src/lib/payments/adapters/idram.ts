import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/security/crypto";
import type { CallbackInput, ParsedCallback, PaymentAdapter, PaymentStart, StartInput } from "@/lib/payments/types";

// Idram merchant (EDP) adapter.
//
// UNVERIFIED against the current Idram merchant documentation: field names
// and the checksum formula below follow the publicly known EDP protocol and
// MUST be checked against the documentation Idram issues with the merchant
// contract before going live (see docs/EXTERNAL_DEPENDENCIES.md).
//
// Flow:
//   start()  → auto-submitted form POST to IDRAM_PAYMENT_URL with
//              EDP_LANGUAGE, EDP_REC_ACCOUNT, EDP_DESCRIPTION, EDP_AMOUNT, EDP_BILL_NO
//   precheck → Idram POSTs EDP_PRECHECK=YES + EDP_BILL_NO/EDP_REC_ACCOUNT/EDP_AMOUNT;
//              we answer "OK" only if the bill exists and the amount matches.
//   result   → Idram POSTs the payment with EDP_CHECKSUM =
//              MD5(EDP_REC_ACCOUNT:EDP_AMOUNT:SECRET_KEY:EDP_BILL_NO:EDP_PAYER_ACCOUNT:EDP_TRANS_ID:EDP_TRANS_DATE)
//              Idram only notifies successful payments.

const LANG: Record<string, string> = { hy: "AM", ru: "RU", en: "EN", it: "EN" };

export function idramChecksum(f: Record<string, string>, secret: string): string {
  const raw = [
    f.EDP_REC_ACCOUNT,
    f.EDP_AMOUNT,
    secret,
    f.EDP_BILL_NO,
    f.EDP_PAYER_ACCOUNT,
    f.EDP_TRANS_ID,
    f.EDP_TRANS_DATE,
  ].join(":");
  return createHash("md5").update(raw).digest("hex").toUpperCase();
}

export const idramAdapter: PaymentAdapter = {
  id: "idram",
  provider: "IDRAM",
  isConfigured: () => Boolean(env().IDRAM_REC_ACCOUNT && env().IDRAM_SECRET_KEY),
  async start(input: StartInput): Promise<PaymentStart> {
    const e = env();
    return {
      kind: "form",
      action: e.IDRAM_PAYMENT_URL,
      fields: {
        EDP_LANGUAGE: LANG[input.locale] ?? "AM",
        EDP_REC_ACCOUNT: e.IDRAM_REC_ACCOUNT!,
        EDP_DESCRIPTION: `Order ${input.orderNumber}`,
        EDP_AMOUNT: input.amountAmd.toFixed(2),
        EDP_BILL_NO: input.paymentId,
      },
    };
  },
  async parseCallback(input: CallbackInput): Promise<ParsedCallback> {
    const e = env();
    const form = Object.fromEntries(new URLSearchParams(input.body)) as Record<string, string>;
    const billNo = form.EDP_BILL_NO;
    const amount = Number(form.EDP_AMOUNT);
    if (!billNo || !Number.isFinite(amount)) return { kind: "invalid", reason: "missing EDP_BILL_NO/EDP_AMOUNT" };
    const accountOk = form.EDP_REC_ACCOUNT === e.IDRAM_REC_ACCOUNT;
    if (form.EDP_PRECHECK === "YES") {
      return { kind: "precheck", paymentId: billNo, amountAmd: Math.round(amount), signatureValid: accountOk };
    }
    const given = (form.EDP_CHECKSUM ?? "").toUpperCase();
    const expected = idramChecksum(form, e.IDRAM_SECRET_KEY ?? "");
    return {
      kind: "result",
      eventId: form.EDP_TRANS_ID ?? "",
      paymentId: billNo,
      outcome: "SUCCEEDED",
      amountAmd: Math.round(amount),
      providerRef: form.EDP_TRANS_ID ?? null,
      signatureValid: accountOk && given.length > 0 && Boolean(form.EDP_TRANS_ID) && safeEqual(given, expected),
    };
  },
  ack(accepted) {
    return new Response(accepted ? "OK" : "FAIL", { status: 200, headers: { "content-type": "text/plain" } });
  },
};
