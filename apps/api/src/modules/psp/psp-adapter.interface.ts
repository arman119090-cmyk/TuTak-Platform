import { Decimal } from '@prisma/client/runtime/library';

/**
 * What a payment provider can do for this platform.
 *
 * Deliberately narrow. Everything here is something the domain genuinely
 * needs; anything a particular provider offers beyond it stays inside that
 * provider's adapter.
 *
 * ## Capabilities, and why they are declared rather than assumed
 *
 * Idram's documentation, as supplied, establishes the bill / pre-check /
 * final-callback sequence and nothing else. It does **not** establish that a
 * refund API, a status query, a void, a settlement feed or a fee statement
 * exist. Those are not small gaps: a refund path built on an API that turns
 * out not to exist is a button that lies to a customer about their money.
 *
 * So each is a declared capability, defaulting to absent. Code that needs one
 * asks first and fails loudly rather than calling into a stub. When Idram
 * answers the questions in the report, turning a capability on is a one-line
 * change in that adapter — and until then the absence is visible in the
 * admin panel instead of being discovered by the first customer who wants
 * their money back.
 */
export interface PspCapabilities {
  /** Can the provider return money for a settled payment through an API? */
  refund: boolean;
  /** Can a payment's authoritative status be queried on demand? */
  statusQuery: boolean;
  /** Can an unsettled payment be cancelled outright? */
  void: boolean;
  /** Does the provider publish a machine-readable settlement feed? */
  settlementFeed: boolean;
  /** Does the provider report its fee per transaction? */
  feeStatement: boolean;
}

export const NO_CAPABILITIES: PspCapabilities = {
  refund: false,
  statusQuery: false,
  void: false,
  settlementFeed: false,
  feeStatement: false,
};

export interface CreateBillParams {
  /** This platform's own identifier for the bill — never the provider's. */
  billId: string;
  amount: Decimal;
  currency: string;
  description: string;
}

export interface CreateBillResult {
  /** Where to send the customer, when the provider works by redirect. */
  redirectUrl?: string;
  /** The provider's identifier for the bill, if it issues one now. */
  providerBillId?: string;
  raw: unknown;
}

/**
 * A confirmation the provider sent us, after it has been proved genuine.
 *
 * `verified` is the whole point of this type existing. A callback that has
 * not had its signature or checksum checked is an anonymous HTTP request
 * claiming somebody paid, and must never reach the code that moves money.
 */
export interface VerifiedConfirmation {
  verified: true;
  billId: string;
  providerTransactionId: string;
  amount: Decimal;
  currency: string;
  /** Present only where the provider states its fee; never inferred. */
  feeAmount?: Decimal;
  raw: unknown;
}

export interface RejectedConfirmation {
  verified: false;
  reason: string;
  raw: unknown;
}

export type ConfirmationResult = VerifiedConfirmation | RejectedConfirmation;

/** Raised when something asks a provider for a capability it does not have. */
export class PspCapabilityUnavailableError extends Error {
  constructor(
    readonly provider: string,
    readonly capability: keyof PspCapabilities,
  ) {
    super(
      `Provider "${provider}" does not support ${capability}. This is a gap in the ` +
        'provider integration, not a transient failure — the operation cannot be ' +
        'retried into working. See docs for the outstanding provider questions.',
    );
    this.name = 'PspCapabilityUnavailableError';
  }
}

export interface PspAdapter {
  readonly name: string;
  readonly capabilities: PspCapabilities;

  /** Opens a bill the customer can pay. */
  createBill(params: CreateBillParams): Promise<CreateBillResult>;

  /**
   * Proves a callback genuine, or refuses it.
   *
   * Implementations must verify cryptographically — a signature, an HMAC, a
   * checksum over the amount — and must compare the amount and the bill
   * identifier the provider reports against what was asked for. Accepting a
   * callback because it arrived at the right URL is not verification.
   */
  verifyCallback(headers: Record<string, string>, body: unknown): Promise<ConfirmationResult>;

  /** Only defined where `capabilities.refund` is true. */
  refund?(params: {
    providerTransactionId: string;
    amount: Decimal;
    idempotencyKey: string;
  }): Promise<{ providerRefundId: string; raw: unknown }>;

  /** Only defined where `capabilities.statusQuery` is true. */
  queryStatus?(providerBillId: string): Promise<ConfirmationResult>;
}

export const PSP_ADAPTER = Symbol('PSP_ADAPTER');
