/**
 * Which ledger postings on a `PARTNER_PAYABLE` account a settlement may claim.
 *
 * ## Why an allow-list and not a deny-list
 *
 * Both are wrong when a new `kind` is introduced and nobody updates this
 * file. They are wrong in opposite directions, and the directions are not
 * equally bad:
 *
 * - A deny-list that forgets a kind **pays it out**. If that kind was a bank
 *   transfer the platform already made, the partner is paid twice and the
 *   money is gone.
 * - An allow-list that forgets a kind **does not pay it out**. The partner is
 *   owed money they have not received — which is bad, but recoverable, and
 *   loud: the posting sits unclaimed for ever, the partner's ledger balance
 *   stops matching the sum of their settlements, and
 *   `unrecognisedKinds` below turns it into a reconciliation finding rather
 *   than silence.
 *
 * The brief's own priority ("невозможно… начисляется или возвращается один и
 * тот же драм дважды") settles it: err towards not paying.
 *
 * ## What is deliberately absent
 *
 * Every kind that *is itself* money moving between TuTak and the partner:
 * `payout.requested`, `payout.settled`, `partner.collection.*` and this
 * engine's own `partner.settlement.paid`. Those postings are the payment, not
 * something to be paid for. Claiming them would either pay a transfer out a
 * second time or deduct a transfer the partner already made twice.
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
  // partner, and the reversal a refund writes. Settleable for the same
  // reason the bonus compensation is — the partner delivered goods and is
  // owed for them by TuTak, not by the customer.
  'partner.prepaid_funding',
  'partner.prepaid_funding_refund',
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
 * Kinds that are money already moving between the two parties, listed so the
 * reconciliation check below can tell "deliberately not settleable" apart
 * from "nobody has classified this yet".
 */
export const TRANSFER_LEDGER_KINDS: ReadonlySet<string> = new Set([
  'payout.requested',
  'payout.settled',
  'partner.collection.recorded',
  'partner.collection.confirmed',
  'partner.settlement.paid',
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
    if (!SETTLEABLE_LEDGER_KINDS.has(kind) && !TRANSFER_LEDGER_KINDS.has(kind)) {
      unknown.add(kind);
    }
  }
  return [...unknown].sort();
}
