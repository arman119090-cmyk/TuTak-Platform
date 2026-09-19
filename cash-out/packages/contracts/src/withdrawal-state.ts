/**
 * The withdrawal state machine.
 *
 * ## Why this shape, and not the obvious one
 *
 * The obvious sequence is "pay the driver, then tell Yandex". It is wrong. Cash
 * Out sits between two systems it does not control:
 *
 *   A. the driver's balance inside the Yandex park (mutated through the Fleet
 *      API by posting a transaction), and
 *   B. a real bank transfer executed by a licensed PSP.
 *
 * Neither system participates in a distributed transaction with us, so one of
 * the two legs will eventually be applied while the other is not. The whole
 * design question is: *which leg do we want to be the one we can take back?*
 *
 *   - A bank transfer that has settled is, for practical purposes, irreversible.
 *     We cannot pull money back off a driver's card.
 *   - A Yandex balance debit is a bookkeeping entry. It can always be undone by
 *     posting a compensating credit of the same magnitude.
 *
 * Therefore the compensatable leg goes first: we debit Yandex, and only once
 * that debit is *known* to have been applied do we instruct the PSP. If the
 * payout then fails, we compensate the Yandex debit and the driver is made
 * whole. If we did it the other way round, a Yandex outage after a successful
 * transfer would mean money left the park's account with no corresponding debit
 * — a direct, unrecoverable loss, one per affected withdrawal.
 *
 * Yandex's Fleet API offers no hold/reserve primitive, only immediate
 * transactions, so the debit *is* the reservation. That is why `RESERVED`
 * exists as a distinct state rather than being folded into `APPROVED`.
 *
 * ## Uncertainty is a state, not an exception
 *
 * Every call to an external system has three outcomes, not two: applied, not
 * applied, and *unknown* (timeout, connection reset, 5xx). Collapsing "unknown"
 * into "failed" is what produces double payouts. Each external call therefore
 * has an explicit `*_UNCERTAIN` state whose only exit is a probe of the remote
 * system keyed by our own idempotency key.
 */

export const WITHDRAWAL_STATES = [
  /** Request accepted, idempotency key bound, quote frozen. Nothing external touched yet. */
  'CREATED',
  /** Automated risk/limit checks are running. */
  'RISK_CHECK',
  /** A human must decide. Money has not moved. */
  'RISK_REVIEW',
  /** Rejected before anything moved — limits, risk, or an admin decision. Terminal. */
  'REJECTED',
  /** The Yandex debit has been submitted and we are waiting for its result. */
  'RESERVING',
  /** The Yandex debit call did not return a definite answer; a probe must resolve it. */
  'RESERVE_UNCERTAIN',
  /** The Yandex debit is confirmed applied. The driver's park balance is already reduced. */
  'RESERVED',
  /** The payout instruction has been submitted to the PSP; awaiting its result. */
  'PAYOUT_SUBMITTING',
  /** The PSP call did not return a definite answer; a probe must resolve it. */
  'PAYOUT_UNCERTAIN',
  /** The PSP accepted the instruction but has not settled it yet. */
  'PAYOUT_SUBMITTED',
  /** The PSP reports the transfer as settled. */
  'PAYOUT_CONFIRMED',
  /** Both legs verified against their source systems by reconciliation. Terminal. */
  'COMPLETED',
  /** The PSP declined the payout. The Yandex debit must be compensated. */
  'PAYOUT_FAILED',
  /** The PSP reversed a previously successful payout. The Yandex debit must be compensated. */
  'PAYOUT_RETURNED',
  /** A compensating Yandex credit is being posted. */
  'COMPENSATING',
  /** The Yandex debit has been compensated; the driver's balance is whole again. Terminal. */
  'REVERSED',
  /** Failed before anything external was mutated. Nothing to compensate. Terminal. */
  'FAILED',
  /** Automated handling is not safe here; an operator owns this withdrawal. */
  'MANUAL_REVIEW',
] as const;

export type WithdrawalState = (typeof WITHDRAWAL_STATES)[number];

/**
 * The legal transitions. Anything not listed here is a bug, and
 * `assertTransition` turns it into a loud error rather than a silent state jump.
 */
const TRANSITIONS: Readonly<Record<WithdrawalState, readonly WithdrawalState[]>> = {
  CREATED: ['RISK_CHECK', 'FAILED', 'REJECTED'],
  RISK_CHECK: ['RESERVING', 'RISK_REVIEW', 'REJECTED', 'FAILED'],
  RISK_REVIEW: ['RESERVING', 'REJECTED', 'MANUAL_REVIEW'],
  REJECTED: [],
  RESERVING: ['RESERVED', 'RESERVE_UNCERTAIN', 'FAILED', 'MANUAL_REVIEW'],
  RESERVE_UNCERTAIN: ['RESERVED', 'RESERVING', 'FAILED', 'MANUAL_REVIEW'],
  RESERVED: ['PAYOUT_SUBMITTING', 'COMPENSATING', 'MANUAL_REVIEW'],
  PAYOUT_SUBMITTING: ['PAYOUT_SUBMITTED', 'PAYOUT_CONFIRMED', 'PAYOUT_UNCERTAIN', 'PAYOUT_FAILED', 'MANUAL_REVIEW'],
  PAYOUT_UNCERTAIN: [
    'PAYOUT_SUBMITTING',
    'PAYOUT_SUBMITTED',
    'PAYOUT_CONFIRMED',
    'PAYOUT_FAILED',
    'MANUAL_REVIEW',
  ],
  PAYOUT_SUBMITTED: ['PAYOUT_CONFIRMED', 'PAYOUT_FAILED', 'PAYOUT_UNCERTAIN', 'MANUAL_REVIEW'],
  PAYOUT_CONFIRMED: ['COMPLETED', 'PAYOUT_RETURNED', 'MANUAL_REVIEW'],
  COMPLETED: ['PAYOUT_RETURNED'],
  PAYOUT_FAILED: ['COMPENSATING', 'MANUAL_REVIEW'],
  PAYOUT_RETURNED: ['COMPENSATING', 'MANUAL_REVIEW'],
  COMPENSATING: ['REVERSED', 'MANUAL_REVIEW'],
  REVERSED: [],
  FAILED: [],
  MANUAL_REVIEW: [
    'RESERVING',
    'PAYOUT_SUBMITTING',
    'COMPENSATING',
    'COMPLETED',
    'REVERSED',
    'FAILED',
    'REJECTED',
  ],
};

export const TERMINAL_STATES: readonly WithdrawalState[] = [
  'COMPLETED',
  'REVERSED',
  'FAILED',
  'REJECTED',
];

/**
 * States in which the driver's Yandex balance has been debited but the money has
 * not (yet) reached them. Every one of these must eventually leave, either
 * forwards to `COMPLETED` or backwards through `COMPENSATING` to `REVERSED`;
 * a withdrawal stuck in one of these past its SLA is what the stuck-withdrawal
 * alert watches for.
 */
export const DEBIT_OUTSTANDING_STATES: readonly WithdrawalState[] = [
  'RESERVED',
  'PAYOUT_SUBMITTING',
  'PAYOUT_UNCERTAIN',
  'PAYOUT_SUBMITTED',
  'PAYOUT_CONFIRMED',
  'PAYOUT_FAILED',
  'PAYOUT_RETURNED',
  'COMPENSATING',
];

/** States whose only safe exit is probing an external system for the real outcome. */
export const UNCERTAIN_STATES: readonly WithdrawalState[] = [
  'RESERVE_UNCERTAIN',
  'PAYOUT_UNCERTAIN',
];

export function isWithdrawalState(value: unknown): value is WithdrawalState {
  return typeof value === 'string' && (WITHDRAWAL_STATES as readonly string[]).includes(value);
}

export function isTerminal(state: WithdrawalState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function isUncertain(state: WithdrawalState): boolean {
  return UNCERTAIN_STATES.includes(state);
}

export function hasOutstandingDebit(state: WithdrawalState): boolean {
  return DEBIT_OUTSTANDING_STATES.includes(state);
}

export function allowedTransitions(state: WithdrawalState): readonly WithdrawalState[] {
  return TRANSITIONS[state];
}

export function canTransition(from: WithdrawalState, to: WithdrawalState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalWithdrawalTransitionError extends Error {
  constructor(
    readonly from: WithdrawalState,
    readonly to: WithdrawalState,
  ) {
    super(`Illegal withdrawal transition ${from} -> ${to}`);
    this.name = 'IllegalWithdrawalTransitionError';
  }
}

export function assertTransition(from: WithdrawalState, to: WithdrawalState): void {
  if (!canTransition(from, to)) {
    throw new IllegalWithdrawalTransitionError(from, to);
  }
}

/**
 * What the driver sees. The internal machine has eighteen states because
 * correctness needs them; a driver on a phone needs five.
 */
export const DRIVER_VISIBLE_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'UNDER_REVIEW',
] as const;

export type DriverVisibleStatus = (typeof DRIVER_VISIBLE_STATUSES)[number];

export function toDriverStatus(state: WithdrawalState): DriverVisibleStatus {
  switch (state) {
    case 'CREATED':
    case 'RISK_CHECK':
      return 'PENDING';
    case 'RISK_REVIEW':
    case 'MANUAL_REVIEW':
      return 'UNDER_REVIEW';
    case 'RESERVING':
    case 'RESERVE_UNCERTAIN':
    case 'RESERVED':
    case 'PAYOUT_SUBMITTING':
    case 'PAYOUT_UNCERTAIN':
    case 'PAYOUT_SUBMITTED':
    case 'COMPENSATING':
      return 'PROCESSING';
    case 'PAYOUT_CONFIRMED':
    case 'COMPLETED':
      return 'SENT';
    case 'PAYOUT_FAILED':
    case 'PAYOUT_RETURNED':
    case 'REVERSED':
    case 'FAILED':
    case 'REJECTED':
      return 'FAILED';
    default: {
      const exhaustive: never = state;
      throw new Error(`toDriverStatus: unhandled state ${String(exhaustive)}`);
    }
  }
}

/**
 * Whether a driver may start a new withdrawal while this one is in `state`.
 * Only one non-terminal withdrawal per driver is allowed at a time; this is the
 * simplest defence against a driver spending the same balance twice from two
 * devices, and it is enforced again at the database level by a partial unique
 * index.
 */
export function blocksNewWithdrawal(state: WithdrawalState): boolean {
  return !isTerminal(state);
}
