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

/**
 * How a customer is sent to the provider to pay.
 *
 * Two shapes, because providers genuinely differ and pretending otherwise
 * pushes the difference into the client. A redirect provider hands back a
 * URL; Idram's documented flow is an HTML form the customer's browser or app
 * posts, so it hands back a method, a target and the exact fields to post.
 *
 * This used to be `raw: unknown` with the form fields buried inside, and
 * `beginAttempt` never passed them out at all — so the documented flow could
 * not actually be performed by any client. Making the shape explicit is the
 * fix; special-casing Idram inside the caller would have been the bug.
 */
export type ProviderHandoff =
  | { type: 'REDIRECT'; url: string }
  | {
      type: 'FORM_POST';
      method: 'POST';
      action: string;
      /** Posted verbatim, in this order. Never re-derived by the client. */
      fields: Record<string, string>;
    };

export interface CreateBillResult {
  /** What the client must do to let the customer pay. */
  handoff: ProviderHandoff;
  /** The provider's identifier for the bill, if it issues one now. */
  providerBillId?: string;
  raw: unknown;
}

/**
 * A provider's pre-check: "does this bill exist and may it be paid?"
 *
 * Idram sends this before taking money. It is **not** a payment and must
 * never touch the ledger — answering it is purely a lookup. The reply shape
 * is the provider's, so the adapter owns it.
 */
export interface PrecheckRequest {
  billId: string | null;
  merchantAccount: string | null;
  /**
   * Whether `merchantAccount` is *this* merchant.
   *
   * Decided by the adapter, which is the only thing that knows its own
   * account, so the domain never has to reach into provider configuration to
   * ask. A pre-check for somebody else's merchant account gets "no" whatever
   * the bill says — see `PspPaymentService.answerPrecheck`.
   */
  merchantMatches: boolean;
  amount: Decimal | null;
  raw: unknown;
}

export interface PrecheckVerdict {
  /** Whether the request itself was well formed and for us. */
  recognised: boolean;
  billId: string | null;
  amount: Decimal | null;
  reason?: string;
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

  /**
   * Throws if this adapter is not configured well enough to open a bill.
   *
   * Called *before* an attempt row is written, so a missing merchant id or
   * form action fails closed with nothing left behind — rather than after,
   * where the first version left an `INITIATED` attempt that blocked the
   * customer from paying again until a human resolved it.
   */
  assertReady(): void;

  /**
   * Opens a bill the customer can pay.
   *
   * For the documented Idram flow this is *local*: it builds the form the
   * customer's browser will post and makes no call to the provider. That is
   * why `beginAttempt` may call it before writing the attempt row. A future
   * provider whose bill creation is a remote call must not be wired into
   * that order without revisiting it — a remote bill with no local row is a
   * different failure than the one the order was chosen to avoid.
   */
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

  /**
   * Reads a pre-check request. Does not decide it: whether the bill may be
   * paid is a domain question, and the adapter only speaks the protocol.
   */
  readPrecheck(body: unknown): PrecheckRequest;

  /** Whether this body is a pre-check rather than a final callback. */
  isPrecheck(body: unknown): boolean;

  /** The provider's own wire format for "yes, proceed" and "no". */
  precheckResponse(verdict: { ok: boolean }): { body: string; contentType: string };

  /** What the provider expects to receive after a final callback. */
  finalResponse(): { body: string; contentType: string };
}

export const PSP_ADAPTER = Symbol('PSP_ADAPTER');
