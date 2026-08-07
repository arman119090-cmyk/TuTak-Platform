import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PspAdapter, PspChargeRequest, PspChargeResult } from './psp-adapter.interface';

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
}
