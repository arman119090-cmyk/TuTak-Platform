import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  PspAdapter,
  PspChargeRequest,
  PspChargeResult,
  PspRefundRequest,
  PspRefundResult,
} from './psp-adapter.interface';

/**
 * Source tokens that trigger a specific sandbox outcome, the same convention
 * real acquirer sandboxes use (Stripe's `tok_chargeDeclined`, etc.) so the
 * pattern will be familiar when this adapter is replaced by a real one.
 * Any token not listed here captures successfully.
 */
export const SANDBOX_TOKENS = {
  DECLINE_INSUFFICIENT_FUNDS: 'tok_decline_insufficient_funds',
  DECLINE_CARD_EXPIRED: 'tok_decline_card_expired',
  DECLINE_GENERIC: 'tok_decline_generic',
  /** Simulates the acquirer being unreachable — an infra failure, not a decline. */
  PSP_UNAVAILABLE: 'tok_psp_unavailable',
} as const;

/**
 * Markers embedded in `RefundParams.reason` to steer the sandbox's refund
 * outcome for tests — `refund()` has no source-token-like field of its own
 * (a refund reverses an existing charge; there is no new payment method to
 * tokenize), so the free-text reason is the only caller-supplied input left
 * to carry a test trigger, the same role `sourceToken` plays for `charge()`.
 * A marker is a substring match, so a real reason can still read naturally
 * around it in a test (e.g. `${SANDBOX_REFUND_TRIGGERS.DECLINE}: card blocked`).
 */
export const SANDBOX_REFUND_TRIGGERS = {
  /** The acquirer refuses the refund outright. */
  DECLINE: '__sandbox_refund_decline__',
  /** `refund()` throws, simulating an unreachable acquirer — never resolves via `checkRefundStatus` either. */
  UNREACHABLE: '__sandbox_refund_unreachable__',
  /** `refund()` returns PENDING; `checkRefundStatus` later reports CONFIRMED — the common "async acquirer" case. */
  PENDING_THEN_CONFIRMED: '__sandbox_refund_pending_then_confirmed__',
  /** `refund()` returns PENDING; `checkRefundStatus` later reports it was actually declined. */
  PENDING_THEN_DECLINED: '__sandbox_refund_pending_then_declined__',
  /** `refund()` returns PENDING and stays genuinely unresolved — `checkRefundStatus` keeps reporting PENDING. */
  PENDING_FOREVER: '__sandbox_refund_pending_forever__',
} as const;

/**
 * A deterministic fake acquirer. There is no real PSP contract yet (Idram,
 * Ameriabank, ArCa — whichever TuTak signs with), so every payment in this
 * codebase runs against this adapter. It exists to let the payment engine,
 * ledger postings and idempotency behaviour be built and fully tested now
 * rather than blocked on that contract — see `PspAdapter` for why swapping
 * it later is a one-file change.
 *
 * MUST NOT be bound in a real deployment: `PaymentsModule` throws on boot if
 * this adapter is selected while `NODE_ENV=production`, the same discipline
 * `SmsModule` already applies to its console provider.
 */
@Injectable()
export class SandboxPspAdapter implements PspAdapter {
  private readonly logger = new Logger(SandboxPspAdapter.name);

  /**
   * The sandbox's own memory of what each refund idempotency key eventually
   * resolves to — a fake's stand-in for the acquirer's own server-side
   * refund records, which is what `checkRefundStatus` would poll on a real
   * integration. Scoped to this adapter instance (a live Nest process), not
   * persisted — a real acquirer's records outlive this process; this map
   * only needs to outlive one test run.
   */
  private readonly refundOutcomes = new Map<
    string,
    { outcome: 'CONFIRMED' | 'FAILED' | 'PENDING'; declineReason?: string }
  >();

  charge(request: PspChargeRequest): Promise<PspChargeResult> {
    if (request.sourceToken === SANDBOX_TOKENS.PSP_UNAVAILABLE) {
      throw new Error('Sandbox PSP: simulated acquirer timeout');
    }

    const decline = this.declineReasonFor(request.sourceToken);
    if (decline) {
      this.logger.log(`Sandbox PSP declined ${request.idempotencyKey}: ${decline}`);
      return Promise.resolve({ outcome: 'DECLINED', declineReason: decline });
    }

    // Deterministic on the idempotency key, not random, so the same logical
    // charge always maps to the same reference — a property a real acquirer
    // provides for free and a fake one has to be deliberate about.
    const pspReference = `sandbox_${createHash('sha256')
      .update(request.idempotencyKey)
      .digest('hex')
      .slice(0, 24)}`;

    return Promise.resolve({ outcome: 'CAPTURED', pspReference });
  }

  private declineReasonFor(sourceToken: string): string | null {
    switch (sourceToken) {
      case SANDBOX_TOKENS.DECLINE_INSUFFICIENT_FUNDS:
        return 'insufficient_funds';
      case SANDBOX_TOKENS.DECLINE_CARD_EXPIRED:
        return 'card_expired';
      case SANDBOX_TOKENS.DECLINE_GENERIC:
        return 'generic_decline';
      default:
        return null;
    }
  }

  refund(request: PspRefundRequest): Promise<PspRefundResult> {
    const reason = request.reason;

    if (reason.includes(SANDBOX_REFUND_TRIGGERS.UNREACHABLE)) {
      // Deliberately not recorded in refundOutcomes: a genuinely unreachable
      // acquirer never told us anything to remember, and checkRefundStatus
      // must fall back to reporting PENDING for a key it has never heard of.
      throw new Error('Sandbox PSP: simulated timeout on refund');
    }

    if (reason.includes(SANDBOX_REFUND_TRIGGERS.DECLINE)) {
      const declineReason = 'sandbox_refund_declined';
      this.refundOutcomes.set(request.idempotencyKey, { outcome: 'FAILED', declineReason });
      this.logger.log(`Sandbox PSP declined refund ${request.idempotencyKey}: ${declineReason}`);
      return Promise.resolve({ outcome: 'DECLINED', declineReason });
    }

    if (reason.includes(SANDBOX_REFUND_TRIGGERS.PENDING_THEN_CONFIRMED)) {
      this.refundOutcomes.set(request.idempotencyKey, { outcome: 'CONFIRMED' });
      return Promise.resolve({ outcome: 'PENDING' });
    }
    if (reason.includes(SANDBOX_REFUND_TRIGGERS.PENDING_THEN_DECLINED)) {
      this.refundOutcomes.set(request.idempotencyKey, {
        outcome: 'FAILED',
        declineReason: 'sandbox_refund_declined_after_pending',
      });
      return Promise.resolve({ outcome: 'PENDING' });
    }
    if (reason.includes(SANDBOX_REFUND_TRIGGERS.PENDING_FOREVER)) {
      this.refundOutcomes.set(request.idempotencyKey, { outcome: 'PENDING' });
      return Promise.resolve({ outcome: 'PENDING' });
    }

    // The ordinary case: the acquirer confirms synchronously. Deterministic
    // on the idempotency key, same reasoning as charge()'s pspReference.
    const pspRefundReference = this.referenceFor(request.idempotencyKey);
    this.refundOutcomes.set(request.idempotencyKey, { outcome: 'CONFIRMED' });
    return Promise.resolve({ outcome: 'REFUNDED', pspRefundReference });
  }

  checkRefundStatus(idempotencyKey: string): Promise<PspRefundResult> {
    const remembered = this.refundOutcomes.get(idempotencyKey);
    // A key this adapter has never seen resolve is indistinguishable from
    // one still being processed — report PENDING rather than guessing.
    if (!remembered || remembered.outcome === 'PENDING') {
      return Promise.resolve({ outcome: 'PENDING' });
    }
    if (remembered.outcome === 'FAILED') {
      return Promise.resolve({
        outcome: 'DECLINED',
        declineReason: remembered.declineReason ?? 'sandbox_refund_declined',
      });
    }
    return Promise.resolve({
      outcome: 'REFUNDED',
      pspRefundReference: this.referenceFor(idempotencyKey),
    });
  }

  private referenceFor(idempotencyKey: string): string {
    return `sandbox_refund_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
  }
}
