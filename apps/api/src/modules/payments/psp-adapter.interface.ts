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

export interface PspRefundRequest {
  amount: Decimal;
  currency: Currency;
  /** The original charge's own PSP reference, so the acquirer can find the capture this refund reverses. */
  pspChargeReference: string;
  /**
   * Sent to the acquirer as *its* idempotency key, exactly like
   * `PspChargeRequest.idempotencyKey`. Callers must derive this
   * deterministically from stable inputs (never a freshly-generated value)
   * so that retrying the same logical refund after a crash — before this
   * process has persisted anything about the first attempt — reproduces the
   * identical key and lets the acquirer's own idempotency guarantee do the
   * work of refusing a second, real refund.
   */
  idempotencyKey: string;
  /** Free-text reason, forwarded to the acquirer where it accepts one. */
  reason: string;
}

export type PspRefundResult =
  | { outcome: 'REFUNDED'; pspRefundReference: string }
  | { outcome: 'DECLINED'; declineReason: string }
  /**
   * The acquirer accepted the request but has not yet confirmed the money
   * actually moved — a normal, expected outcome for many real acquirers'
   * async refund APIs, not a failure. The caller must not treat this as
   * "refunded"; `checkRefundStatus` is how it is later resolved.
   */
  | { outcome: 'PENDING'; pspRefundReference?: string };

/**
 * The seam between the payment engine and a real acquirer.
 *
 * Nothing above this interface knows or cares which PSP is behind it. Ledger
 * postings, the Payment row, and the outbox event are all driven off
 * `PspChargeResult`/`PspRefundResult` alone — swapping `SandboxPspAdapter`
 * for a real Idram, Ameriabank or ArCa client is a one-file change, not a
 * redesign.
 *
 * A decline is a normal, expected outcome and must be returned, not thrown —
 * "the card was declined" is business data the caller needs to record and
 * show the customer. Throwing is reserved for the PSP being unreachable or
 * behaving unexpectedly (a network timeout, a 5xx, a malformed response) —
 * the one case where retrying (or, for a refund already submitted,
 * reconciling) might help. `RefundEngineService` treats a thrown `refund()`
 * exactly like an explicit `PENDING` result: the outcome is unknown, not
 * failed, and is resolved later by `checkRefundStatus`, never assumed.
 */
export interface PspAdapter {
  charge(request: PspChargeRequest): Promise<PspChargeResult>;
  /**
   * Requests a refund of a previously-captured charge. Must be safe to call
   * more than once with the same `idempotencyKey` — a caller that could not
   * tell whether an earlier call reached the acquirer needs to be able to
   * retry without risking a second real refund, and the acquirer's own
   * idempotency handling (keyed on this same value) is what makes that safe
   * rather than merely hopeful.
   */
  refund(request: PspRefundRequest): Promise<PspRefundResult>;
  /**
   * Polls the acquirer for the current outcome of a refund previously
   * submitted with this `idempotencyKey`, for resolving a `PENDING` result
   * (or a thrown `refund()`) once the ambiguity clears. Must never itself
   * submit a new refund — a pure status read.
   */
  checkRefundStatus(idempotencyKey: string): Promise<PspRefundResult>;
}
