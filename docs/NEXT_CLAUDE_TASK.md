# TuTak — Current Claude Task

This file is the canonical current task for Claude. Before starting or continuing implementation, read this file together with `docs/TUTAK_MASTER_PROJECT_CONTEXT_2026-08-16.md`, `docs/design/TUTAK_UI_UX_MASTER_SPEC_V1.md` (when present), `docs/HARDENING_AUDIT_2026-08-16.md`, `docs/LAUNCH_READINESS_2026-08-16.md`, and GitHub Issue #28 `TuTak — Independent Audit Findings`.

## STATUS AS OF 2026-08-18

**No outstanding engineering task is queued.** The prior task on this file
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
   `docs/DEPLOYMENT.md`: a real PSP/acquirer contract, an SMS carrier
   account, Expo push credentials, a real `CORS_ORIGINS`/`REDIS_URL`/
   TLS-terminated hostname, an actual deploy target + container registry
   subscription, and a monitoring/alerting recipient. `PaymentsModule`/
   `SmsModule`/`RedisModule` already refuse to boot in production without
   these — nothing here is a code gap, only an operational one.
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
