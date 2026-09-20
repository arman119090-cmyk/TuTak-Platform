import { PaymentProviderPort } from '../payment-provider/payment-provider.port';

/**
 * iDram, as Cash Out needs it: the payout rail (inherited from
 * `PaymentProviderPort` — instruct, probe, webhook) plus the one thing a wallet
 * has that a card token does not: an account that can be looked up and
 * verified before any money is sent to it.
 *
 * ## What is and is not known
 *
 * No iDram payout or account API documentation is available to this project.
 * Nothing here encodes a real request shape, a real endpoint, or a real error
 * code. The port is the contract a live adapter must be made to fit once iDram
 * provides one, and `IdramMockAdapter` is the only implementation. The config
 * validator refuses `PROVIDER_MODE=live` because there is nothing to resolve
 * it to, and refuses `mock` in production because it does not move money.
 */
export abstract class IdramProviderPort extends PaymentProviderPort {
  /**
   * Checks that an account id refers to a wallet that can receive payouts and
   * returns what the driver may be shown about it. Never returns the id back
   * unmasked.
   */
  abstract verifyAccount(input: VerifyIdramAccountInput): Promise<IdramAccountVerification>;
}

export interface VerifyIdramAccountInput {
  readonly accountId: string;
  readonly holderName?: string;
  readonly driverReference: string;
}

export type IdramAccountVerification =
  | {
      readonly status: 'VERIFIED';
      readonly maskedIdentifier: string;
      readonly holderName: string | null;
      /** Provider-side identity, so the same wallet on two drivers is noticed. */
      readonly fingerprint: string;
      /** The durable reference the payout instruction will carry. */
      readonly instrumentToken: string;
    }
  | {
      readonly status: 'PENDING';
      readonly maskedIdentifier: string;
      readonly holderName: string | null;
      readonly fingerprint: string;
      readonly instrumentToken: string;
    }
  | { readonly status: 'REJECTED'; readonly maskedIdentifier: string; readonly reason: string }
  | { readonly status: 'UNKNOWN'; readonly reason: string };
