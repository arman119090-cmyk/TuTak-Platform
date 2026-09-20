import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { Clock } from '../../common/clock';
import { PaymentProviderMockAdapter } from '../payment-provider/payment-provider-mock.adapter';
import { IdramAccountVerification, IdramProviderPort, VerifyIdramAccountInput } from './idram.port';

/**
 * An in-memory iDram.
 *
 * **MOCK. This does not talk to iDram and does not move money.** It inherits
 * the payout, probe and webhook behaviour of the generic mock rail (so the
 * orchestrator, ledger and reconciliation are exercised against the same
 * three-valued outcomes: settled, declined, unknown) and adds account
 * verification with a few deterministic cases:
 *
 *  - an id ending in `0000` is rejected (no such wallet);
 *  - an id ending in `9999` is accepted but pending (wallet exists, not yet
 *    allowed to receive);
 *  - `unavailable` mode answers UNKNOWN, as a timeout would;
 *  - anything else is verified, with a holder name derived from the id.
 *
 * Nothing about these cases is a claim about the real iDram API.
 */
@Injectable()
export class IdramMockAdapter extends PaymentProviderMockAdapter implements IdramProviderPort {
  override readonly name: string;

  private readonly verifications = new Map<string, IdramAccountVerification>();
  accountBehaviour: 'normal' | 'unavailable' = 'normal';

  constructor(@Inject(ENV) env: Env, clock: Clock) {
    super(env, clock);
    this.name = env.PROVIDER_NAME;
  }

  override reset(): void {
    super.reset();
    this.verifications.clear();
    this.accountBehaviour = 'normal';
  }

  async verifyAccount(input: VerifyIdramAccountInput): Promise<IdramAccountVerification> {
    this.callLog.push({ method: 'verifyAccount' });
    if (this.accountBehaviour === 'unavailable' || this.behaviour.mode === 'unavailable') {
      return { status: 'UNKNOWN', reason: 'mock_idram_unavailable' };
    }

    const cached = this.verifications.get(input.accountId);
    if (cached) return cached;

    const masked = maskAccount(input.accountId);
    let result: IdramAccountVerification;
    if (input.accountId.endsWith('0000')) {
      result = { status: 'REJECTED', maskedIdentifier: masked, reason: 'no such wallet' };
    } else if (input.accountId.endsWith('9999')) {
      result = {
        status: 'PENDING',
        maskedIdentifier: masked,
        holderName: input.holderName ?? null,
        fingerprint: `idram:${input.accountId}`,
        instrumentToken: `idram_${input.accountId}`,
      };
    } else {
      result = {
        status: 'VERIFIED',
        maskedIdentifier: masked,
        holderName: input.holderName ?? `Holder ${input.accountId.slice(-4)}`,
        fingerprint: `idram:${input.accountId}`,
        instrumentToken: `idram_${input.accountId}`,
      };
    }
    this.verifications.set(input.accountId, result);
    return result;
  }
}

/** "•••• 1234": the only form of the id that ever leaves the server. */
export function maskAccount(accountId: string): string {
  return `•••• ${accountId.slice(-4)}`;
}
