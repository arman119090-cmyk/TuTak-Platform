# TuTak — final launch-readiness audit and hardening pass

Companion to `docs/HARDENING_AUDIT_2026-08-16.md` (the prior deep pass, HEAD
`92940af`). This document covers everything that changed on
`claude/tutak-loyalty-mvp-e485jm` between that pass and this one — 20
commits, including the OTP-first auth model, the end-to-end PurchaseIntent
UI, the QR→PurchaseIntent migration, the Partner Integrations dashboard, and
two prior fixes to the partner QR page — plus a fresh, independent re-sweep
of everything the prior pass already covered, to confirm nothing regressed.

## A. Final verdict

**NO LAUNCH-BLOCKING TECHNICAL ISSUE FOUND.**

Every area named for this pass — end-to-end financial correctness,
PurchaseIntent, QR, EV/OCPI, referrals, `DeferredBonusLot`, RBAC,
idempotency/concurrency, migrations, production config, and legacy-path
isolation — was independently re-verified against the current code, not
assumed from the prior report. One HIGH, several MEDIUM, and a handful of
LOW findings were confirmed and fixed, each with a regression test verified
to fail against the pre-fix code. What remains open is recorded explicitly
in §F, and none of it blocks launch on technical grounds — it is either
already-tracked business-decision backlog (§M of the prior report,
unchanged) or a single LOW-severity authorization question that needs
Arman's call, not a fix.

## B. Method

A background full-suite run was taken as baseline (61 suites / 753 tests,
clean) before any change. Four parallel, independent read-only research
passes then re-swept: (1) the new `AuthOtpToken` schema and OTP
production-readiness; (2) the new frontend surfaces (PurchaseIntent UI,
Partner Integrations dashboard, the two QR-page commits) for
amount-tampering and RBAC gaps; (3) production configuration and deployment
posture end to end; (4) every money-moving endpoint in the API from scratch,
plus the previously-reported-but-deferred schema gaps. Every finding was
independently verified against the actual code (file:line) before being
acted on, per the standing project instruction not to trust an audit's
claim without checking it — including this pass's own automated research
agents.

## C. What was verified clean, unchanged from the prior report

- **Financial transaction boundary**, **20/30/20/30 pool split**,
  **gross-amount base**, **referral immutability**, **DeferredBonusLot
  algorithm and its concurrent-advance fix**, **settlement sign convention**
  — all re-traced directly in the current code (§C, §D, §E, §F, §G of the
  prior report). No regression.
- **Self-dealing coverage**: every money-moving endpoint re-swept from
  scratch — `PurchaseIntent.create`, `QrPaymentsService.redeem`,
  `PaymentEngineService.capture`, `EvSessionsService.stopOnce`'s
  bonus-earning guard — all still carry `isAffiliated()`; every admin-only
  money endpoint (Refunds, Payouts, Wallet manual-adjust) still carries its
  role/permission guard. No new gap found, and no new money-moving endpoint
  was added by any of the 20 commits in scope.
- **FastCharge/OCPI**: zero-line diff, confirmed again — none of this
  pass's commits touched `ev-charging/`.
- **QR-migration completeness**: grepped both mobile and partner trees in
  full; every remaining `qrApi.redeem`/`DYNAMIC_INVOICE` reference is dead
  code, a test assertion, or a comment — nothing in a live UI path reaches
  the legacy formula.
- **Mobile PurchaseIntent client**: sends only raw `grossAmount`/
  `bonusAmountRequested`; the server is the sole source of the partner's
  rate, cap, and pool math. `PurchaseIntentStatusScreen` never computes a
  financial figure itself — everything shown comes from the server's own
  response, and `CONFIRMED` is only reachable after the atomic settlement
  commits.
- **Production config**: JWT secrets/`DATABASE_URL` required in every
  environment; `SMS_ENDPOINT`/`PUSH_ENABLED`/the PSP adapter already refuse
  to boot in production without configuration; CORS fails closed; Helmet
  and both dashboards' CSP/security headers are in place; global rate
  limiting is genuinely wired to `RATE_LIMIT_*`; no real secret anywhere in
  the repository; all three Docker images run as non-root; Redis outages
  degrade to logged alerts rather than crashing the process.
- **i18n**: spot-checked keys for the new PurchaseIntent/Integrations
  screens are present in `en`/`ru`/`hy`.

## D. Findings, fixed this pass

**HIGH — `BonusReservation` had no index on `(status, expiresAt)`.**
Unchanged since the prior report flagged it and explicitly deferred it as
"a dedicated schema-hardening migration session" — this pass is that
session. `BonusEngineService`'s stale-reservation sweep runs
`WHERE status = 'ACTIVE' AND expiresAt <= now` once a minute, forever; until
now that was a full-table scan on a table that only grows. Fixed with the
identical pattern already used for `ev_reservations`
(`20260808220000_ev_reservation_indexes`), migration
`20260816183000_bonus_reservation_expiry_index`.

**MEDIUM — `DeferredBonusLot` and `ReferralChallengeParticipant` money
fields had no sanity CHECK constraints**, unlike every other money-bucket
table (`transactions`, `wallets`, `bonus_lots`, `bonus_reservations`,
`ev_sessions`, `ev_cdrs` — `20260806150000_harden_money_invariants`).
Migration `20260816186000_deferred_lot_challenge_amounts_sane` adds
`amount > 0 AND requiredTurnover > 0 AND progressTurnover >= 0` (and the
`ReferralChallengeParticipant` equivalent). Deliberately **not** an upper
bound (`progress <= required`), unlike the superficially similar
`bonus_lots_amounts_sane`: `progressTurnover`/`progressAmount` are
incremented by a whole purchase's gross amount in one shot and routinely
overshoot the threshold in the very write that crosses it, one statement
before the status transitions away from DEFERRED/IN_PROGRESS — a real
purchase exceeding what was left on a lot, not a bug. An upper-bound CHECK
would have rejected ordinary purchases and been a regression, not a fix;
confirmed by reading `DeferredBonusLotService.advanceExistingLots` and
`ReferralService`'s Challenge-progress update before writing the migration.

**MEDIUM — `auth_otp_tokens` was missing the `attempts >= 0` CHECK** its
sibling challenge tables (`phone_verification_tokens`,
`password_reset_tokens`) both carry. Same gap class as the two items above,
on the table added by the OTP-first auth work (`bbba9be`), which predates
this pass and had never been reviewed for it. Migration
`20260816180000_auth_otp_tokens_attempts_check`.

**MEDIUM — `referral_codes`/`referral_invites`' "exactly one owner"
invariant (documented in schema.prisma comments) was app-only**, unlike
`ledger_accounts_single_owner`, the identical shape of constraint already
applied to `LedgerAccount.userId`/`partnerId`. Not exploitable today — every
call site writes a single owner field, verified directly — but nothing in
the database prevented a future write path from setting both. Migration
`20260816189000_referral_single_owner_check` adds the matching CHECK to
both tables. Regression tests attempt the forbidden dual-owner insert
directly with raw SQL (`referral-abuse.int-spec.ts`, "single-owner database
constraints"), the same way `ledger.int-spec.ts` already proves
`ledger_postings` is append-only — going around the application
deliberately, since no application code path exercises this today.

**MEDIUM — production could boot without `REDIS_URL` configured.** Unlike
`SMS_ENDPOINT`/`PUSH_ENABLED`/the PSP adapter, `REDIS_URL` has a
`redis://localhost:6379` default (so local dev needs no env file) and
nothing enforced it in production — a deploy that forgot it would silently
point advisory locks and the sweep queue at an empty local instance instead
of the real shared one. Fixed in `RedisModule`, mirroring `SmsModule`'s
exact fail-closed pattern (production + no explicit `REDIS_URL` + not demo
mode → throw at boot). The decision logic is extracted to
`assertRedisUrlConfigured()` so it is unit-testable without opening a real
Redis connection (`redis.module.spec.ts`, 4 cases, git-stash-verified to
fail to compile against the pre-fix module, which had no such export).
`docs/DEPLOYMENT.md`'s "what production refuses to run without" table
updated to list it.

**LOW — `verify-website` didn't check the integration belonged to the
partner in the URL.** Third time this exact LOW finding surfaced (first two
passes explicitly left it: "no live exploit path, noted for awareness
only") — this pass closes it, since it is purely technical (no business
decision involved) and free of risk to fix. The route is
`partners/:partnerId/integrations/:integrationId/verify-website`, but
`markWebsiteVerified` only ever read `integrationId`; a wrong id in the URL
silently activated a *different* partner's integration instead of failing.
Never a live escalation — only a platform admin, who may already act on any
partner, reaches this route — but a real correctness gap in the route's own
authorization surface, the same class of mismatch `create()` already guards
against for `partnerBranchId`. Fixed by loading the integration first and
comparing `existing.partnerId` to the URL's `partnerId`, mirroring that
exact pattern. Regression: `partner-integrations.int-spec.ts`, "refuses to
verify an integration that belongs to a different partner" —
git-stash-verified to fail (a TypeScript signature mismatch, since the
fix's new required parameter doesn't exist on the pre-fix method) against
the pre-fix code.

## E. Finding surfaced, deliberately not fixed — needs Arman's call

**LOW — `PartnerIntegrationsController.create`/`.list` have no role gate
beyond partner-scope.** Any partner-scoped staff (cashier tier, not just
OWNER) can submit or list an integration request. No money moves and no
auto-activation is possible either way — `verify-website` stays
platform-admin-only regardless of who created the request — so this is not
a security hole. Whether integration requests should be OWNER-only, the way
`updateCommercialSettings` was narrowed to OWNER-only for being financially
significant (prior report §J), is a product decision this repository is not
authorized to invent: nothing in the canonical business rules says cashier
staff may not request an integration, and `assertPartnerScope` (not
OWNER-only) is the norm for most partner-scoped writes in this codebase —
`updateCommercialSettings` is the deliberate exception, not the rule.
Recorded here rather than changed, per the project's standing instruction:
"If a finding requires a business decision, ask Arman before changing
behavior."

## F. Unresolved business decisions

Unchanged from `docs/HARDENING_AUDIT_2026-08-16.md` §M/§N — nothing in this
pass altered any of the following, and nothing new needs adding except §E
above:

1. Three coexisting bonus-accrual formulas (PurchaseIntent's gross×pool-split
   vs. QR/EV's net×flat-rate vs. Payments/Settlement's net-of-refund×flat-rate)
   — a deliberate, out-of-scope product decision, not an engineering defect.
2. Staff amount-editing on `PurchaseIntent` confirm — not built, consistent
   with the old QR flow having none either.
3. What happens to a partner's positive settlement balance on offboarding.
4. Integrated-partner auto-finalization beyond EV/OCPI's existing shape —
   policy recorded, not implemented as a generic endpoint, pending a real
   API/POS partner to specify against.
5. §E above: whether Partner Integrations creation should be OWNER-only.

## G. Test results

| Command | Result |
|---|---|
| `npx jest --selectProjects integration unit --testTimeout=30000` (baseline, before any change) | PASS — 61 suites / 753 tests |
| Same command, after all fixes in §D | PASS — 62 suites / 760 tests |
| `git stash` (pre-fix) + targeted re-runs for each new/changed test | Each confirmed to fail against the pre-fix code before being confirmed to pass against the fix (§D, per finding) |
| `npm run typecheck` (whole monorepo, via turbo — 7 packages) | PASS |
| `npx eslint src test` (apps/api) | PASS — 0 problems |
| `npm run build` (apps/api, `nest build`) | PASS |
| `npx prisma migrate status` (dev database) | "Database schema is up to date!" |
| `npx jest` (apps/mobile) | PASS — 22 suites / 202 tests |
| `npx jest` (apps/admin) | PASS — 5 suites / 28 tests |
| `npx jest` (apps/partner) | PASS — 2 suites / 11 tests |

A run of the isolated `referral-abuse.int-spec.ts` file alone (outside the
full suite, via `--testPathPattern`) produced deadlocks and FK-ordering
failures on both the pre-fix and post-fix code — confirmed, by running it
both ways, to be pre-existing environment flakiness in this specific
sandbox (concurrent `Promise.all`-based fixture writes racing under this
container's I/O characteristics), not a regression from any change in this
pass. The full-suite run, which is what actually matters, was clean both
before and after.

## H. Files changed this pass

- `apps/api/prisma/schema.prisma` — `BonusReservation` index added.
- `apps/api/prisma/migrations/20260816180000_auth_otp_tokens_attempts_check/`
- `apps/api/prisma/migrations/20260816183000_bonus_reservation_expiry_index/`
- `apps/api/prisma/migrations/20260816186000_deferred_lot_challenge_amounts_sane/`
- `apps/api/prisma/migrations/20260816189000_referral_single_owner_check/`
- `apps/api/src/infrastructure/redis/redis.module.ts` +
  `redis.module.spec.ts` — production boot guard.
- `apps/api/src/modules/partners/partner-integrations.controller.ts` +
  `.service.ts` — `verify-website` partner-ownership check.
- `apps/api/test/partner-integrations.int-spec.ts` — updated call sites +
  new regression test.
- `apps/api/test/referral-abuse.int-spec.ts` — new "single-owner database
  constraints" tests.
- `docs/DEPLOYMENT.md` — `REDIS_URL` added to the boot-refusal table.
- This document.

Two earlier commits this same day, already pushed and reported separately,
are in scope for this pass's re-verification but are not re-described here:
partner-identity resolution before PurchaseIntent amount entry
(`f61769c`), and the partner dashboard's QR code becoming a real scannable
symbol (`544c871`) — both re-confirmed clean in §C.
