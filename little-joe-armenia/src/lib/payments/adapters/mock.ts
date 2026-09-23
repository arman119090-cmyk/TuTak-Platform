import "server-only";
import type { PaymentProviderCode } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { hmacHex, safeEqual } from "@/lib/security/crypto";
import type { CallbackInput, ParsedCallback, PaymentAdapter, PaymentStart, StartInput } from "@/lib/payments/types";

// Sandbox provider used while merchant credentials are missing
// (PAYMENTS_MODE=mock). It behaves like a real hosted payment page:
//   1. start() redirects the shopper to /pay/mock/<paymentId>
//   2. the sandbox page lets the tester approve or decline
//   3. the "provider" sends a signed server-to-server callback to
//      /api/payments/callback/mock — the ONLY thing that changes the order.
// The browser return URL never marks anything paid.

export function mockSecret(): string {
  return env().MOCK_PAYMENT_SECRET ?? `${env().SESSION_SECRET}:mock-payments`;
}

export type MockCallbackBody = {
  eventId: string;
  paymentId: string;
  outcome: "SUCCEEDED" | "FAILED";
  amountAmd: number;
  providerRef: string;
};

export function signMockBody(body: string): string {
  return hmacHex(mockSecret(), body);
}

export function createMockAdapter(provider: PaymentProviderCode): PaymentAdapter {
  return {
    id: "mock",
    provider,
    isConfigured: () => env().PAYMENTS_MODE === "mock",
    async start(input: StartInput): Promise<PaymentStart> {
      const url = new URL(`/${input.locale}/pay/mock/${input.paymentId}`, env().APP_URL);
      return { kind: "redirect", url: url.toString() };
    },
    async parseCallback(input: CallbackInput): Promise<ParsedCallback> {
      const signature = input.headers.get("x-mock-signature") ?? "";
      const valid = signature.length > 0 && safeEqual(signature, signMockBody(input.body));
      let parsed: MockCallbackBody;
      try {
        parsed = JSON.parse(input.body) as MockCallbackBody;
      } catch {
        return { kind: "invalid", reason: "malformed JSON" };
      }
      if (
        typeof parsed.eventId !== "string" ||
        typeof parsed.paymentId !== "string" ||
        (parsed.outcome !== "SUCCEEDED" && parsed.outcome !== "FAILED") ||
        !Number.isInteger(parsed.amountAmd)
      ) {
        return { kind: "invalid", reason: "missing fields" };
      }
      return {
        kind: "result",
        eventId: parsed.eventId,
        paymentId: parsed.paymentId,
        outcome: parsed.outcome,
        amountAmd: parsed.amountAmd,
        providerRef: parsed.providerRef ?? null,
        signatureValid: valid,
      };
    },
    ack(accepted) {
      return Response.json({ ok: accepted }, { status: accepted ? 200 : 400 });
    },
  };
}
