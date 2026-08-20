# TuTak — Current Claude Task

This file is the canonical current task for Claude. Before starting or continuing implementation, read this file together with `docs/TUTAK_MASTER_PROJECT_CONTEXT_2026-08-16.md`, `docs/design/TUTAK_UI_UX_MASTER_SPEC_V1.md` (when present), `docs/HARDENING_AUDIT_2026-08-16.md`, `docs/LAUNCH_READINESS_2026-08-16.md`, and GitHub Issue #28 `TuTak — Independent Audit Findings`.

## STATUS AS OF 2026-08-19

**One engineering task is now queued: rework the referral engine from
single-level to a 3-level upward chain.** Decided by Arman (2026-08-19),
not yet implemented — budget ran out before starting. Do this next, before
picking up anything else on this file.

### Queued task: 3-level referral chain

**The decision, recorded exactly as given:**

- The referral model changes from the current **single-level** design (see
  `docs/HARDENING_AUDIT_2026-08-16.md`'s "Rewrite referral engine to
  single-level + partner-as-referrer" entry — that was itself a deliberate
  prior decision, now superseded) to a **3-level upward chain**: Level 1 is
  whoever directly referred the customer; Level 2 is whoever referred
  Level 1; Level 3 is whoever referred Level 2.
- Reward rates: **Level 1 = 1%, Level 2 = 0.5%, Level 3 = 0.5%** — 2% total
  across up to three people, per qualifying transaction.
- **Base: the commission pool the partner pays TuTak** — the same pool
  that currently funds the 20/30/20/30 split (`docs/TUTAK_MASTER_PROJECT_
  CONTEXT_2026-08-16.md` §pool distribution), not gross transaction amount
  and not new money on top of that pool.

**Explicitly NOT yet resolved — do not guess these, ask Arman before
writing code:**

1. **How the 2% total reconciles with the existing 20/30/20/30 legs.**
   The current split already allocates one leg to "referrer" (single
   level). Does the new 1%/0.5%/0.5% *replace* that leg's share of the
   pool entirely (i.e. the referrer leg's percentage becomes 2%, split
   3 ways up the chain), or is it a separate carve-out that changes the
   other three legs' shares? The numbers as given don't say.
2. **What happens below 3 levels of chain.** If Level 2 or Level 3 doesn't
   exist (the referrer was never themselves referred), does their share
   go unpaid, roll up to TuTak, or roll down to the levels that do exist?
3. **Chain data model.** The current schema (`ReferralInvite`,
   `resolveReferrer` in `referral.service.ts`) only resolves one level up.
   Walking 3 levels needs either a recursive lookup (fine at this scale,
   simplest) or a materialized chain — pick based on how `resolveReferrer`
   is actually called on the hot path today.
4. **Existing single-level referral data / in-flight invites.** Does this
   apply going forward only, or does it need to backfill/reinterpret
   existing `ReferralInvite` rows that only ever recorded one level?
5. Everything else the single-level rewrite already had to answer once
   (partner-as-referrer handling, immutability of attribution, Referral
   Challenge interaction, refund clawback) needs re-checking against 3
   levels instead of 1 — don't assume the old single-level logic
   generalizes cleanly.

When implemented: update this file to remove this entry, and record the
decision + implementation in `docs/HARDENING_AUDIT_2026-08-16.md` the way
every prior decision has been recorded.

---

The prior task on this file
(migrate the customer QR purchase flow to `PurchaseIntent`) is done — see
`docs/HARDENING_AUDIT_2026-08-16.md`'s 2026-08-18 update note and commits
`c3156a8`/`db4d51d`. Every technical finding raised across every audit pass
in this repository's history (`docs/AUDIT_*.md`, `docs/WEAK_SPOTS_RU.md`,
`docs/HARDENING_AUDIT_2026-08-16.md`, `docs/LAUNCH_READINESS_2026-08-16.md`)
has been fixed and verified, most recently the FastCharge/EV settlement
economics unification (commit `164ff60`).

**All four §E/§F business decisions have since been resolved by Arman
(2026-08-18)** and are recorded here so this file stays the single source of
truth — do not re-ask about any of these:

- **Partner Integrations OWNER-only: yes, implemented.**
  `PartnerIntegrationsController.create`/`.list` now call
  `assertPartnerOwner` (new helper, `common/auth/partner-scope.ts`, also
  used to de-duplicate `updateCommercialSettings`'s identical check) — a
  scoped MANAGER/STAFF is refused with `ForbiddenException`. Partner
  dashboard's `/integrations` page gates on `isPartnerOwner` (new helper,
  `authStore.ts`) and shows an explanatory message instead of a broken form
  for non-owners. Regression tests in `partner-integrations.int-spec.ts`.
- **Staff amount-editing on `PurchaseIntent` confirm: no, stays
  Confirm/Reject only.** No code change — this is already the existing
  behavior, now confirmed as the deliberate final answer, not a gap.
- **Partner offboarding balance: handled outside the platform, by
  contract.** Deliberately **not** automated in code — no payout is
  triggered by deactivation, and no new endpoint was built. Settlement of
  a deactivated partner's balance is a matter for that partner's individual
  contract, resolved manually. Do not build a generic
  "auto-payout-on-deactivation" feature for this — it was explicitly
  rejected in favor of the contractual path.
- **Generic integrated-partner auto-finalization endpoint: no, still
  deferred.** Confirmed: keep building it against a real API/POS partner
  when one exists, not speculatively now. Matches the policy already
  recorded pre-2026-08-18.

What remains before a real launch is **not code**:

1. **External credentials/infrastructure** the repository cannot supply
   itself — see `docs/LAUNCH_READINESS_2026-08-16.md` §I.5 and
   `docs/DEPLOYMENT.md`: an SMS carrier account, Expo push credentials, a
   real `CORS_ORIGINS`/`REDIS_URL`/TLS-terminated hostname, an actual
   deploy target + container registry subscription, and a
   monitoring/alerting recipient. `SmsModule`/`RedisModule` already
   refuse to boot in production without these — nothing here is a code
   gap, only an operational one. **A PSP/acquirer contract is explicitly
   NOT on this list** (business decision, 2026-08-18): TuTak never takes
   customer money — the customer pays the partner directly — so
   `PaymentsModule` stays off by default (`CARD_PAYMENTS_ENABLED` unset)
   and partner payouts are settled by manual bank transfer, confirmed in
   the admin dashboard. See `docs/LAUNCH_READINESS_2026-08-16.md` §I.5
   for the full record. Room is left to enable a real PSP later if TuTak
   ever needs to move customer money itself — not needed now.
2. **Legal decisions**: exact data-retention periods (`docs/WEAK_SPOTS_RU.md`
   item 11 — the sweep mechanism is built, the numbers must come from a
   lawyer), who custodies the backup encryption private key (item 5).
3. **Store submission logistics** (`docs/STORE_SUBMISSION.md`): actual Apple
   Developer / Google Play accounts, listing content, and screenshots —
   this is account/asset work, not engineering.

No open product/business decisions remain on this list — §E/§F of
`docs/LAUNCH_READINESS_2026-08-16.md` is fully resolved as of 2026-08-18.

## Persistent instruction

At the start of every new TuTak task/session, re-read this file and the
master project context before changing code. If a business decision above
is answered by Arman, implement it exactly as decided, update this file to
remove the resolved item, and record it in
`docs/HARDENING_AUDIT_2026-08-16.md` or `docs/LAUNCH_READINESS_2026-08-16.md`
the way every prior decision in this repository's history has been recorded.
Do not invent a new business rule to fill a gap in this list — ask Arman.
