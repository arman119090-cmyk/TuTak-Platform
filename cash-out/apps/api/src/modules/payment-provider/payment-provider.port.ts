import { Money } from '@cashout/money';

/**
 * The licensed bank or PSP that actually moves money to the driver's account.
 *
 * Like the Yandex port, every mutating call is three-valued. Unlike it, the
 * "applied" case is itself two-valued: most rails accept an instruction now and
 * settle it later, so `SUBMITTED` and `CONFIRMED` are different facts and the
 * driver must not be told "sent" on the strength of the first one.
 */
export abstract class PaymentProviderPort {
  abstract readonly name: string;

  /**
   * Instructs a transfer. `idempotencyKey` is ours and is stable across every
   * retry of the same withdrawal; a provider that honours it will never create
   * a second transfer, and `probe` exists for the ones that might.
   */
  abstract createPayout(input: PayoutInstruction): Promise<PayoutOutcome>;

  /** Asks the provider what really happened, keyed by our own idempotency key. */
  abstract probe(idempotencyKey: string): Promise<PayoutOutcome>;

  /**
   * Exchanges the single-use token collected by the provider's SDK for the
   * durable token we store, plus the masked identifier we show. Raw card data
   * never reaches Cash Out, so this is the only way an instrument enters.
   */
  abstract registerInstrument(input: RegisterInstrumentInput): Promise<RegisteredInstrument>;

  /** Verifies a webhook's signature and timestamp, and parses it. */
  abstract parseWebhook(
    raw: string,
    headers: Record<string, string | undefined>,
  ): WebhookParseResult;

  abstract ping(): Promise<boolean>;
}

export interface PayoutInstruction {
  readonly idempotencyKey: string;
  /** Our own reference, echoed back on statements and in webhooks. */
  readonly reference: string;
  /** The net amount — what the driver receives. Fees are already deducted. */
  readonly amount: Money;
  readonly instrumentToken: string;
  readonly beneficiaryName?: string;
  readonly description: string;
}

export type PayoutOutcome =
  | {
      readonly status: 'SUBMITTED';
      readonly providerTransactionId: string;
      readonly raw?: string;
    }
  | {
      readonly status: 'CONFIRMED';
      readonly providerTransactionId: string;
      /** What the provider charged us, when it tells us at confirmation time. */
      readonly providerCost?: Money;
      readonly raw?: string;
    }
  | {
      readonly status: 'REJECTED';
      readonly code: string;
      readonly message: string;
      readonly providerTransactionId?: string;
    }
  | { readonly status: 'UNKNOWN'; readonly reason: string }
  | { readonly status: 'NOT_FOUND' };

export interface RegisterInstrumentInput {
  readonly singleUseToken: string;
  readonly driverReference: string;
  readonly currency: string;
}

export interface RegisteredInstrument {
  readonly token: string;
  readonly maskedIdentifier: string;
  readonly displayName: string | null;
  /** Provider-side identity of the instrument, used for cross-driver dedupe. */
  readonly instrumentFingerprint: string;
  readonly status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'REJECTED';
  readonly rejectionReason?: string;
}

export type WebhookParseResult =
  | { readonly ok: true; readonly event: ProviderWebhookEvent }
  | { readonly ok: false; readonly reason: WebhookRejectionReason };

export type WebhookRejectionReason =
  | 'missing_signature'
  | 'bad_signature'
  | 'missing_timestamp'
  | 'stale_timestamp'
  | 'malformed_payload';

export interface ProviderWebhookEvent {
  /** The provider's id for this delivery. Used to make redelivery a no-op. */
  readonly externalId: string;
  readonly type: 'payout.submitted' | 'payout.confirmed' | 'payout.failed' | 'payout.returned';
  /** Our reference, which is how the event finds its withdrawal. */
  readonly reference: string;
  readonly providerTransactionId: string;
  readonly occurredAt: Date;
  readonly failureCode?: string;
  readonly failureMessage?: string;
  readonly providerCost?: Money;
  readonly raw: unknown;
}

export class PaymentProviderUnavailableError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PaymentProviderUnavailableError';
  }
}
