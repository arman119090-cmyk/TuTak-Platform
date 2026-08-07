import { Currency } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export const PSP_ADAPTER = 'PSP_ADAPTER';

export interface PspChargeRequest {
  amount: Decimal;
  currency: Currency;
  /** Opaque payment-method reference from the client SDK — a tokenized card, never a PAN. */
  sourceToken: string;
  /** Handed to the acquirer as its own idempotency key so a retried HTTP call cannot double-charge on their side either. */
  idempotencyKey: string;
}

export type PspChargeResult =
  | { outcome: 'CAPTURED'; pspReference: string }
  | { outcome: 'DECLINED'; declineReason: string };

/**
 * The seam between the payment engine and a real acquirer.
 *
 * Nothing above this interface knows or cares which PSP is behind it. Ledger
 * postings, the Payment row, and the outbox event are all driven off
 * `PspChargeResult` alone — swapping `SandboxPspAdapter` for a real Idram,
 * Ameriabank or ArCa client is a one-file change, not a redesign.
 *
 * A decline is a normal, expected outcome and must be returned, not thrown —
 * "the card was declined" is business data the caller needs to record and
 * show the customer. Throwing is reserved for the PSP being unreachable or
 * behaving unexpectedly, which is the one case where retrying might help.
 */
export interface PspAdapter {
  charge(request: PspChargeRequest): Promise<PspChargeResult>;
}
