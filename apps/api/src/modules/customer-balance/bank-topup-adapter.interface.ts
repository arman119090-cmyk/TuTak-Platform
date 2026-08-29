import { Currency } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export const BANK_TOPUP_ADAPTER = 'BANK_TOPUP_ADAPTER';

export type TopUpInitiateResult =
  | { outcome: 'INITIATED'; providerReference: string; redirectUrl?: string }
  | { outcome: 'DECLINED'; declineReason: string };

export interface TopUpWebhookResult {
  providerReference: string;
  outcome: 'COMPLETED' | 'DECLINED' | 'FAILED';
  declineReason?: string;
}

/**
 * The seam between `CustomerBalanceService` and a real bank/PSP top-up
 * provider (Idram or otherwise) — see
 * docs/ROAMING_CPO_PREPAID_BALANCE_2026-08-29.md. Modelled directly on
 * `OcpiAdapter`/`PspAdapter`: nothing above this interface knows or cares
 * which bank is behind it, and connecting a real one is a one-file change
 * (implement this interface, then point `CustomerBalanceModule`'s provider
 * at it) plus whatever config that class needs — not a redesign.
 */
export interface BankTopUpAdapter {
  /**
   * Starts a top-up with the bank. `idempotencyKey` must be forwarded as
   * *the bank's own* idempotency key, the same discipline
   * `PspChargeRequest.idempotencyKey` already documents, so a retried HTTP
   * call on our side cannot double-initiate on theirs either.
   */
  initiateTopUp(params: {
    userId: string;
    amount: Decimal;
    currency: Currency;
    idempotencyKey: string;
  }): Promise<TopUpInitiateResult>;

  /**
   * Verifies and interprets an inbound top-up confirmation callback.
   * Returns null when the payload does not verify — an unknown reference, a
   * bad signature — which the caller must treat exactly like "nothing
   * happened," never partially trust an unverified payload.
   *
   * Takes the parsed JSON body, not raw bytes: this app has no raw-body
   * capture wired anywhere today. A real adapter that needs an
   * HMAC-over-raw-bytes signature (most banks do) will need that added
   * alongside it — an expected, visible piece of writing that adapter, not
   * something this interface tries to guess at in advance.
   */
  verifyTopUpWebhook(
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<TopUpWebhookResult | null>;
}
