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
3. **Open product/business decisions requiring Arman's explicit call**
   (`docs/LAUNCH_READINESS_2026-08-16.md` §E/§F — do not implement any of
   these without asking first, per the project's standing instruction):
   - Whether `PartnerIntegrationsController.create`/`.list` should be
     OWNER-only, like `updateCommercialSettings` was narrowed to be (§E).
   - Whether staff should be able to edit a customer's amount on
     `PurchaseIntent` confirm (currently: cashier can only Confirm/Reject,
     matching the old QR flow's behavior).
   - What happens to a partner's positive settlement balance on
     offboarding.
   - Whether integrated-partner auto-finalization (EV/OCPI's existing
     shape) should become a generic endpoint for other API/POS partners —
     policy is recorded, not built, pending a real partner to specify
     against.
4. **Store submission logistics** (`docs/STORE_SUBMISSION.md`): actual Apple
   Developer / Google Play accounts, listing content, and screenshots —
   this is account/asset work, not engineering.

## Persistent instruction

At the start of every new TuTak task/session, re-read this file and the
master project context before changing code. If a business decision above
is answered by Arman, implement it exactly as decided, update this file to
remove the resolved item, and record it in
`docs/HARDENING_AUDIT_2026-08-16.md` or `docs/LAUNCH_READINESS_2026-08-16.md`
the way every prior decision in this repository's history has been recorded.
Do not invent a new business rule to fill a gap in this list — ask Arman.
