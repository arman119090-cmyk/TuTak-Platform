import type { PaymentProviderCode } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/config";

// Provider adapter contract. Adapters never touch the database: they build
// the provider-side payment start and parse/verify callbacks. All state
// changes happen in payments/service.ts, which is provider-agnostic.

export type PaymentStart =
  | { kind: "redirect"; url: string }
  // Providers such as Idram expect an auto-submitted HTML form POST.
  | { kind: "form"; action: string; fields: Record<string, string> };

export type StartInput = {
  paymentId: string;
  orderNumber: string;
  amountAmd: number;
  locale: Locale;
  returnUrl: string;
  callbackUrl: string;
};

export type ParsedCallback =
  // Provider asks "is this bill payable?" before charging (Idram precheck).
  | { kind: "precheck"; paymentId: string; amountAmd: number; signatureValid: boolean }
  | {
      kind: "result";
      // Provider-unique id of this notification; used for idempotency.
      eventId: string;
      paymentId: string;
      outcome: "SUCCEEDED" | "FAILED";
      amountAmd: number;
      providerRef: string | null;
      signatureValid: boolean;
    }
  | { kind: "invalid"; reason: string };

export type CallbackInput = {
  body: string;
  contentType: string;
  headers: Headers;
};

export interface PaymentAdapter {
  /** Stable id stored on Payment/PaymentEvent rows and used in the webhook URL. */
  readonly id: string;
  readonly provider: PaymentProviderCode;
  /** True when every credential this adapter needs is present. */
  isConfigured(): boolean;
  start(input: StartInput): Promise<PaymentStart>;
  parseCallback(input: CallbackInput): Promise<ParsedCallback>;
  /** Response body the provider expects after a callback was accepted / rejected. */
  ack(accepted: boolean): Response;
}

export class PaymentNotAvailableError extends Error {
  constructor(provider: string) {
    super(`Payment provider ${provider} is not available`);
    this.name = "PaymentNotAvailableError";
  }
}
