/**
 * How far an invitation has got.
 *
 * PENDING       — the invited person has an account and has not yet paid.
 * QUALIFIED     — they paid; the reward is owed but not yet issued.
 * REWARDED      — the referrer's points have been credited.
 * EXPIRED       — the invitation ran out before it qualified.
 * FRAUD_BLOCKED — the referral ring detector held it; no reward is issued.
 *
 * An enum rather than the inline union this used to be. The union was
 * correct and invisible: nothing could check it against the schema it
 * mirrors, and nothing could check that a person is ever shown a real label
 * for each value. Every other status a customer sees is an enum for exactly
 * that reason — see `vocabulary-drift.spec.ts` in the API, which holds
 * schema, type and the three locales to the same list.
 */
export enum ReferralInviteStatus {
  PENDING = 'PENDING',
  QUALIFIED = 'QUALIFIED',
  REWARDED = 'REWARDED',
  EXPIRED = 'EXPIRED',
  FRAUD_BLOCKED = 'FRAUD_BLOCKED',
}
