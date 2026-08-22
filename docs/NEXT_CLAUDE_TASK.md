# TuTak — Current Claude Task

This file is the canonical current task for Claude. Before starting or continuing implementation, read this file together with `docs/TUTAK_MASTER_PROJECT_CONTEXT_2026-08-16.md`, `docs/design/TUTAK_UI_UX_MASTER_SPEC_V1.md` (when present), `docs/HARDENING_AUDIT_2026-08-16.md`, `docs/LAUNCH_READINESS_2026-08-16.md`, and GitHub Issue #28 `TuTak — Independent Audit Findings`.

## STATUS AS OF 2026-08-22

**The 3-level referral chain rework is DONE, implemented, tested, and
pushed to `claude/tutak-loyalty-mvp-e485jm`.** See
`docs/HARDENING_AUDIT_2026-08-16.md`'s 2026-08-22 entry for the full
implementation report (formula, migration, files, test matrix, commands,
remaining risks). No engineering task is currently queued on this file.

Summary for anyone landing here without reading the audit doc: the
single-level 20/30/20/30 pool split (green/deferred/referrer/TuTak) is
replaced outright by a six-leg split — 20% green / 30% deferred / 10% L1 /
5% L2 / 5% L3 / 30% TuTak (residual) — paid up to 3 levels up the referral
chain (L1 = direct referrer, L2 = whoever referred L1, L3 = whoever
referred L2). A partner referrer at any level is paid via the existing
partner-payable ledger, never a wallet, and does not continue the chain. A
missing level's share always folds into TuTak's residual, never left
unpaid or redistributed. `ReferralProgramVersion` (`LEGACY_SINGLE_LEVEL` /
`THREE_LEVEL_V2`) is the explicit, persisted eligibility boundary on every
`PurchaseIntent`/`EvSession` row — old rows are never reinterpreted, and a
refund/CDR-correction on a legacy row reverses it exactly as it was
originally priced, never re-walking today's chain. The Referral Challenge
(1,000+1,000 AMD, TuTak-funded) is untouched — L1-only, as it always was.

<details>
<summary>Archived: the original queued-task record for this rework (2026-08-19, kept for history)</summary>

### Queued task: 3-level referral chain — RESOLVED 2026-08-22, see above

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

**RESOLVED (2026-08-19) — the new pool split, replacing 20/30/20/30
outright.** Given verbatim by Arman as a worked example against a 10%
commission pool (i.e. the partner's negotiated rate is 10% of gross): of
that 10%, 2% → customer's green (available) account, 3% → customer's
black (deferred) account, 1% → Level-1 referrer, 0.5% → Level-2 referrer,
0.5% → Level-3 referrer, 3% stays with TuTak. That's 2+3+1+0.5+0.5+3 = 10,
i.e. the whole pool, with nothing added on top — confirms the "base" line
above.

Expressed as **fractions of the pool** (so it scales to whatever
`negotiatedRateBps` an individual partner actually has, not just the 10%
example): **TuTak 30% · Green 20% · Deferred(black) 30% · Referral L1 10%
· Referral L2 5% · Referral L3 5%** — six legs summing to 100% of the
pool, replacing the old four-leg 20/30/20/30. Whatever order/naming the
current four legs use in code (`ev-sessions.service.ts`'s
`postEvContributionLedgerIdempotent` and the PurchaseIntent equivalent),
the new leg set is these six, at these six fractions — do not reuse the
old 20/30/20/30 constants, they're superseded.

**RESOLVED (2026-08-19) — what happens below 3 levels of chain.** Any
level's share that has no recipient (chain shorter than 3 — e.g. the
Level-1 referrer was never themselves referred, so there's no Level 2 or
3) goes to TuTak, not left unpaid and not redistributed to the levels that
do exist. Simplest implementation: TuTak's leg is the residual (pool minus
whatever green/deferred/L1/L2/L3 legs actually had a recipient), the same
"derive the last leg as a residual rather than round it independently"
pattern the ledger posting code already uses elsewhere for exactly this
kind of rounding/no-recipient safety.

**CONFIRMED FINAL (2026-08-19), verbatim from Arman: "Всё это новая модель
и это окончательная модель"** — this is the whole model, and it is final.
No further business decisions are open on the referral rework; the two
items below are implementation choices, not business questions, and can be
made unilaterally during implementation without asking Arman first:

- **Chain data model.** The current schema (`ReferralInvite`,
  `resolveReferrer` in `referral.service.ts`) only resolves one level up.
  Walking 3 levels needs either a recursive lookup (fine at this scale,
  simplest) or a materialized chain — pick based on how `resolveReferrer`
  is actually called on the hot path today.
- **Existing single-level referral data / in-flight invites.** Since this
  is confirmed as the new final model rather than a variant that has to
  coexist with the old one, treat it as applying going forward: no need to
  reinterpret or backfill old `ReferralInvite` rows into a 3-level shape
  that never applied to them — a chain simply resolves however far up it
  actually goes for rows created after the rework ships.
- Everything else the single-level rewrite already had to answer once
  (partner-as-referrer handling, immutability of attribution, Referral
  Challenge interaction, refund clawback) still needs re-checking against
  3 levels instead of 1 during implementation — don't assume the old
  single-level logic generalizes cleanly, but this is verification work,
  not a new business question.

When implemented: update this file to remove this entry, and record the
decision + implementation in `docs/HARDENING_AUDIT_2026-08-16.md` the way
every prior decision has been recorded.

</details>

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
