/**
 * How the settlement engine reads each `kind` of ledger posting on a
 * `PARTNER_PAYABLE` account.
 *
 * Every posting on that account is exactly one of three things, and the
 * audit of 21.09.2026 (findings D01–D03) showed that two of the three were
 * being confused with each other:
 *
 * 1. **Economic** (`SETTLEABLE_LEDGER_KINDS`) — something the partner is
 *    owed for, or owes for: commission, the compensation for a discount
 *    they granted, the customer's prepaid money a sale turned into TuTak's
 *    debt, a provider capture TuTak collected on their behalf, and the
 *    reversals refunds write. A settlement *pays for* these.
 *
 * 2. **Allocation** (`ALLOCATION_LEDGER_KINDS`) — money that already moved
 *    between the two parties *against the unclaimed residual*: a legacy
 *    payout request (TuTak paid the partner outside the settlement engine)
 *    and a partner's collection (the partner paid TuTak). Nothing is owed
 *    for these; they are the answer to what was owed. The next settlement
 *    must claim them alongside the economic postings they settled, so the
 *    two net out and the residual is allocated exactly once. Leaving them
 *    unclaimed — what the engine did before — meant a legacy payout left
 *    its entitlement free to be paid a second time (D02), and a collection
 *    left the debt it paid free to be deducted a second time (D03).
 *
 * 3. **Settled** (`SETTLED_LEDGER_KINDS`) — the counterpart of entries a
 *    settlement already claimed: this engine's own `partner.settlement.paid`
 *    debit. Its credits are inside a PAID settlement, so it must *never* be
 *    claimed: doing so would deduct the paid amount from the next settlement
 *    a second time.
 *
 * ## Why an allow-list and not a deny-list
 *
 * Both are wrong when a new `kind` is introduced and nobody updates this
 * file. They are wrong in opposite directions, and the directions are not
 * equally bad: a deny-list that forgets a kind **pays it out**; an
 * allow-list that forgets a kind **does not pay it out**, which is bad but
 * recoverable and loud — the posting sits unclaimed, the partner's ledger
 * balance stops matching the settlement view, and `unrecognisedKinds` turns
 * it into a reconciliation finding. That is exactly what D01 looked like:
 * `psp.payment.captured` was written by the provider path and classified by
 * nobody, so 14 000 of provider money sat outside every settlement. The
 * contract test `settleable-kinds.spec.ts` now refuses a writer that posts
 * to the payable under a kind this file does not know.
 */
export const SETTLEABLE_LEDGER_KINDS: ReadonlySet<string> = new Set([
  // The live QR / PurchaseIntent path — commission owed, referral shares
  // earned, and the compensation for a discount the partner granted.
  'partner.contribution',
  'partner.contribution_refund',
  'partner.bonus_redemption_compensation',
  'partner.bonus_redemption_compensation_refund',
  // The prepaid funding component (20.09.2026): the customer's own stored
  // money that a confirmed purchase turned into money TuTak owes the
  // partner, and the reversal a refund writes.
  'partner.prepaid_funding',
  'partner.prepaid_funding_refund',
  // The provider route (21.09.2026, audit D01): TuTak collected the
  // customer's money through the PSP on the partner's behalf; the capture
  // credits the payable and is owed to the partner like any other sale.
  'psp.payment.captured',
  'qr.redeemed.mirror',
  // EV charging the partner hosts.
  'ev.charging.contribution',
  'ev.charging.contribution.correction',
  'ev.roaming.app_settlement',
  'roaming.margin.settlement',
  // The card path, if it is ever switched on.
  'payment.captured',
  'payment.refunded',
  // Referral challenge rewards a partner earns and their reversals.
  'referral.challenge_reward',
  'referral.challenge_reward_reversed',
  'settlement.bonus_accrued',
]);

/**
 * Money that already moved against the unclaimed residual. Claimed by the
 * next settlement so it nets out against what it settled — see the file
 * docblock. `payout.failed` is the reversal a bounced legacy payout writes;
 * it returns the money and travels with the request it cancels.
 */
export const ALLOCATION_LEDGER_KINDS: ReadonlySet<string> = new Set([
  'payout.requested',
  'payout.failed',
  'partner.collection.recorded',
  'partner.collection.confirmed',
]);

/**
 * The counterpart of entries already inside a PAID settlement. Never
 * claimed. `payout.settled` moves clearing to bank and does not touch the
 * payable at all; it is listed so a stray posting of it is recognised
 * rather than reported as unknown.
 */
export const SETTLED_LEDGER_KINDS: ReadonlySet<string> = new Set([
  'partner.settlement.paid',
  'payout.settled',
]);

/** Everything a settlement claims: the economic postings and their allocations. */
export const CLAIMABLE_LEDGER_KINDS: ReadonlySet<string> = new Set([
  ...SETTLEABLE_LEDGER_KINDS,
  ...ALLOCATION_LEDGER_KINDS,
]);

/**
 * Kept for readers that only need "is this money already moving": the
 * allocation and settled sets together. Prefer the specific set.
 */
export const TRANSFER_LEDGER_KINDS: ReadonlySet<string> = new Set([
  ...ALLOCATION_LEDGER_KINDS,
  ...SETTLED_LEDGER_KINDS,
]);

/** The ledger `kind` this engine writes when a settlement is paid. */
export const SETTLEMENT_PAID_KIND = 'partner.settlement.paid';

/**
 * Kinds nobody has decided about. A non-empty result is a reconciliation
 * finding, not a crash: the money is safe (unclassified postings are never
 * claimed), but somebody has to say which list the kind belongs in before the
 * partner's balance can be trusted to be fully settleable.
 */
export function unrecognisedKinds(kinds: Iterable<string>): string[] {
  const unknown = new Set<string>();
  for (const kind of kinds) {
    if (!CLAIMABLE_LEDGER_KINDS.has(kind) && !SETTLED_LEDGER_KINDS.has(kind)) {
      unknown.add(kind);
    }
  }
  return [...unknown].sort();
}
