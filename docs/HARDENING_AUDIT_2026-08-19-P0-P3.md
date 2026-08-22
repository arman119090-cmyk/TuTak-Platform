# TuTak — Security/financial hardening pass, 2026-08-19 (GitHub issue #28 execution brief)

Response to Arman's formal execution brief posted as a comment on GitHub
Issue #28, 2026-08-19. Scope: verify every P0–P3 finding against current
HEAD (not the historical issue comments), fix only what remains genuinely
open, and prove both directions — mark what is already fixed as
`ALREADY FIXED` with evidence, don't reimplement it. Referral-engine work
(single-level → 3-level chain) is explicitly out of scope for this pass —
tracked separately in `docs/NEXT_CLAUDE_TASK.md`.

## 1. HEAD BEFORE / HEAD AFTER

- **HEAD BEFORE:** `c0bec0c295a213ea1b370399d597ae78898463a0`
- **HEAD AFTER:** `899c093505fc0b0ce0a8240cf152a43aa2afe4af` — the last
  commit that changes code or tests. This document and its companion
  summary in `docs/HARDENING_AUDIT_2026-08-16.md` are committed immediately
  after, as documentation-only commits on top of that SHA; `git log` on
  `claude/tutak-loyalty-mvp-e485jm` shows the exact chain.
- **Branch:** `claude/tutak-loyalty-mvp-e485jm`, pushed.

Four commits in scope for this pass, in order:

1. `c00c5f5` — P0 fix: PSP refunds must move real money before being recorded.
2. `a121d89` — Follow-up: gate the new refund-reconciliation sweep on `CARD_PAYMENTS_ENABLED` (a regression the P0 fix itself introduced and this session caught and fixed before it reached the branch's usual green state).
3. `2c72d37` — P2 fix: stop trusting `X-Forwarded-For` with no real proxy in front (the pentest-reported gap).
4. `899c093` — P1 test: reconciliation/rounding-boundary regression test for the pool split (no code fix — the invariant was already correct).

## 2. Findings matrix

| Severity | Finding | Status before this pass | Action taken | Proof |
|---|---|---|---|---|
| **P0/CRITICAL** | PSP refunds must move real money | **OPEN** — `PspAdapter` had `charge()` but no refund operation at all; `RefundEngineService` posted reversing ledger entries, clawed back bonus, and marked `Payment.refundedAmount`/`Refund` complete purely from its own decision, with no acquirer ever asked to move money | **FIXED** — `PspAdapter.refund()`/`checkRefundStatus()` added (typed, idempotent, decline-vs-timeout-vs-pending distinguished); `Refund` born `PENDING` (additive migration, `RefundPspStatus`); claim + durable row created atomically before the PSP is ever called; ledger post + bonus clawback deferred until CONFIRMED; `reconcilePendingRefunds()` wired into the sweep scheduler (every 2 min, gated on `CARD_PAYMENTS_ENABLED`) | `refund-psp-confirmation.int-spec.ts` (12 tests: full/partial refund, decline, timeout/unknown, PSP-success-then-local-DB-failure recovered via reconciliation, duplicate request against a PENDING refund, concurrent duplicate attempts, PENDING claim correctly counted toward the captured-amount cap). Git-stash-verified: fails to compile against pre-fix `refund-engine.service.ts` (the whole PSP-confirmation surface does not exist there) |
| **P0/bonus finding** | Bonus clawback and the reversing ledger post were two independent statements inside the refund finalize path, not one transaction | **OPEN** (found while adding the P0 transaction boundary, not in the original brief) — a clawback that succeeded while the following ledger post failed left a customer's points already taken back with no ledger entry and no CONFIRMED refund to justify it | **FIXED** — clawback now runs inside the same `$transaction` as the ledger post and the `Refund.pspStatus = CONFIRMED` update | Same suite, "recovers from a local failure after the PSP already confirmed the refund" test; `BonusEngineService.reverseAccrualLot` already accepted an optional `tx` and simply wasn't being passed one |
| **P0/regression this pass introduced and fixed** | `SweepsModule` importing `PaymentsModule` unconditionally to wire the refund-reconciliation sweep forced `PaymentsModule`'s own production boot guard (real PSP or `DEMO_MODE=true`) into every deployment, breaking "TuTak never takes customer money, `PaymentsModule` stays off by default" | **OPEN** (self-introduced, caught by this session's own full-suite run before it reached green) | **FIXED** — `sweeps.jobs.ts`/`sweeps.module.ts` mirror `app.module.ts`'s own `cardPaymentsEnabled` gate; `SweepDependencies.refunds` is optional | `production-boot.int-spec.ts` test D (new) + tests A–C (pre-existing, now passing again) |
| **P1/HIGH** | PurchaseIntent terminal transitions must be atomic | **ALREADY FIXED**, no code change needed | Verified only — `reject()` and `expireOne()` already wrap the status claim, reservation release, source-transaction cleanup, and audit record in one `$transaction`; `confirm()`/`settlePurchase()` does the same. Concurrent confirm/reject/expire races resolve via the conditional `updateMany` claim pattern (exactly one winner) | `purchase-intents.int-spec.ts` — "rolls back the status claim if the reservation release fails mid-transaction" (reject), "rolls back the expiry status claim..." (expire), "lets a confirm and a reject race...", "lets an expiry sweep and a confirm race..." — 39 tests, all passing on HEAD BEFORE, re-confirmed passing on HEAD AFTER |
| **P1/HIGH** | Self-dealing/affiliation bypass across every live purchase path | **ALREADY FIXED**, no code change needed | Verified only — `isAffiliated()` (not the narrower `isMember()`) used consistently in `QrPaymentsService.redeem`, `PurchaseIntentsService.create`, `PaymentEngineService.capture`, `EvSessionsService.stopOnce`'s earning guard; legacy `POST /qr/redeem` refuses unconditionally at the HTTP boundary; `AdminService.revokeRole` genuinely deletes the `UserRole` row (not a soft-disable), so `isAffiliated` and JWT-derived claims both re-evaluate correctly the next request | `self-dealing.int-spec.ts` (owner, second colleague, UserRole-only staff, unaffiliated customer, spend-after-removal-of-earning cases), `qr-payments.int-spec.ts`, `payment-engine.int-spec.ts` |
| **P1/HIGH** | QR substitution / merchant identity | **ALREADY FIXED**, no code change needed | Verified only — partner's QR is a static, amount-free `TUTAK-PAY:<partnerId>` payload; `ScanQrScreen` extracts only `partnerId`, never a display name, from the scanned text; `CreatePurchaseIntentScreen` always re-resolves the partner from `GET /partners/:id` and disables the amount form until that resolves to a name and `isActive: true`, failing closed on load error/inactive/not-found; server-side `create()` uses `findActiveOrThrow` (fails closed) and validates `partnerBranchId` against the resolved partner | `apps/mobile/.../ScanQrScreen.test.tsx`, `CreatePurchaseIntentScreen.test.tsx`, `purchase-intents.int-spec.ts` — "refuses to create a purchase intent against a partner still pending approval", branch-mismatch test |
| **P1/HIGH** | Consistent financial economics across live paths | **ALREADY FIXED / documented business decision**, missing regression-test evidence at a rounding boundary | Verified + **new test added** — three formulas are a recorded, deliberate product decision (`docs/HARDENING_AUDIT_2026-08-16.md` §D/§M item 5), not an engineering defect: PurchaseIntent's gross×pool-split is canonical; EV now shares the same pool-split shape behind an upfront TuTak cut (2026-08-18 decision); the QR net×flat-rate formula is unreachable via HTTP; Payments/Settlement is a distinct product (real card/PSP settlement, off by default). Added the reconciliation test the brief explicitly asks for: green + deferred + referrer + TuTak summing exactly to the pool at a boundary where no leg divides evenly | `purchase-intents.int-spec.ts` — "reconciles green + deferred + referrer + TuTak to the pool exactly, even when no leg divides evenly". Verified meaningful (not tautological): temporarily reverted `tutakBase` to independent rounding (the historical bug pattern the residual construction replaced), re-ran, got exactly the predicted `BadRequestException: Ledger transaction does not balance: debits - credits = 0.0003` from `LedgerService.post()`'s own balance check; reverted immediately after |
| **P2/MEDIUM** | Integration activation type confusion (`markWebsiteVerified`) | **ALREADY FIXED**, no code change needed | Verified only — fetches the row, checks `existing.partnerId === partnerId`, then `existing.type === WEBSITE`, all before any write; `BadRequestException` otherwise | `partner-integrations.int-spec.ts` — `it.each` over API/POS/EV_CHARGING/OCPI, 21 tests total |
| **P2** | Rate limiting bypassable via spoofed `X-Forwarded-For` (live pentest, 2026-08-19) | **OPEN** — `app.set('trust proxy', 1)` unconditionally, no real proxy in front | **FIXED** — `TRUST_PROXY` env var, defaults to untrusted (Express's own `false`); when set, passed to Express verbatim as a string (never a JS number, so `proxy-addr`'s hop-count path is structurally unreachable through this var) | `trust-proxy.spec.ts` (8 tests) + direct inspection of `express`/`proxy-addr` source confirming `typeof val === 'string'` never gets hop-count treatment and `proxyaddr.compile('1')` trusts nothing. Git-stash-verified: fails to compile without `trust-proxy.ts` |
| **P2** | Auth/OTP/session abuse review (registration path, replay, rate limits, refresh rotation, role staleness) | **ALREADY FIXED** except the trust-proxy item above | Verified only — `AuthOtpService.consumeCode` claims via conditional `updateMany(consumedAt: null)` (atomic, replay-proof), expiry checked in the same query, `attempts` counter enforces a ceiling; `AuthService.refresh` rotates via the same conditional-claim pattern and detects reuse by revoking the whole device's token family; `JwtStrategy.validate` re-derives role/permission claims fresh from the DB on every request — the JWT payload itself carries only `sub`/`phone`/`deviceId`, no roles, so a revoked role has zero residual access on the very next request; password/legacy registration still requires a full `RegisterDto` (no bypass into a lighter demo path found) | `auth-otp.int-spec.ts`, `session-security.int-spec.ts` (13 — refresh rotation/reuse/lockout, regression suite for `docs/AUDIT_2026-08-B.md` §H1/§H10), `password.int-spec.ts`, `account-state.int-spec.ts` (8), `phone-verification.int-spec.ts` |
| **P2** | IDOR / RBAC / tenant isolation | **ALREADY FIXED**, no code change needed | Verified — dedicated existing suites plus my own spot checks of `purchase-intents.controller.ts`, `payouts.controller.ts`, `refunds.controller.ts` (admin-only), `wallet.controller.ts` (`me`-scoped, no `:id`), `referral.controller.ts` (`me`-scoped), `partners.controller.ts`, `ev-charging.controller.ts` — every `:id` route loads the record first and checks the *loaded* `customerId`/`partnerId`/`userId` against the caller, never trusts a client-supplied value | `idor-sweep.int-spec.ts` (9, systematic id-substitution sweep across every route not covered elsewhere), `partner-tenant-isolation.int-spec.ts` (13), `authorization.int-spec.ts` (17), `partner-disclosure.int-spec.ts` (4), `transaction-disclosure.int-spec.ts` (5) |
| **P2** | Replay / idempotency / concurrency | **ALREADY FIXED** broadly, **extended** for the new P0 mechanism | Verified existing coverage + added new coverage specific to PSP-refund confirmation (duplicate request against a PENDING refund, concurrent duplicate attempts, claim-counted-while-pending) | `idempotency.int-spec.ts` (9), `concurrency-probe.int-spec.ts` (15), `reservation-race.int-spec.ts` (7), `crash-recovery.int-spec.ts` (9), plus `refund-psp-confirmation.int-spec.ts`'s own idempotency/concurrency tests |
| **P2** | External event / webhook / CDR trust boundary (FastCharge/EV, future integrations) | **NOT REPRODUCIBLE on current HEAD** | No fix — no inbound webhook/integration-event endpoint exists to forge against. `EvSessionsService.reportMeterValue` is the customer's own authenticated JWT self-reporting a reading, bounded by a physical-plausibility ceiling (`METER_TOLERANCE`, proportional to elapsed time × connector power) — a different threat model (self-reported fraud, already mitigated) from "impersonate a trusted integration event." `EvCdrReconciliationService`/`http-ocpi-adapter.service.ts` only ever *fetches* CDR data outbound, using this server's own configured `OCPI_BASE_URL`/`OCPI_TOKEN` — nothing external pushes into this codebase. `docs/NEXT_CLAUDE_TASK.md` confirms the generic integrated-partner auto-finalization endpoint is deliberately not built yet, pending a real API/POS partner to specify against | Direct code inspection of `ev-sessions.service.ts` (physical-bounds ceiling, lines ~60-95), `http-ocpi-adapter.service.ts` (outbound-only, server-config-sourced URL/token) |
| **P3** | Input / HTTP security regression | **ALREADY FIXED / clean**, no code change needed | Verified — `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` global; CORS throws at boot if `CORS_ORIGINS` unset outside development; Helmet; Swagger mounted only in `development`; refresh cookie `httpOnly` + `secure` in production/staging + `sameSite: 'strict'` + scoped `path`; no `$queryRawUnsafe`/`$executeRawUnsafe` anywhere in `src/` (all 8 raw-SQL call sites use parameterized tagged-template `$queryRaw`/`$executeRaw`); all 4 outbound `fetch()` call sites (OCPI adapter, SMS provider, push provider, alert webhook) use a server-configured URL, never a partner/user-supplied one — no SSRF vector; the only `dangerouslySetInnerHTML` use (admin/partner dashboards) is a static theme-init script from a shared design package, not user data; no file-upload surface exists (body/upload limits N/A) | `error-disclosure.int-spec.ts` (10), `transaction-disclosure.int-spec.ts`, `partner-disclosure.int-spec.ts`, `minting-ceiling.int-spec.ts` (4), plus direct grep/inspection for raw SQL, SSRF, and HTML-sink patterns across `src/` and the admin/partner frontends |

### New, LOW-severity finding — noticed, not fixed (out of scope for this pass)

While testing the P0 fix, `RefundEngineService.refund()`'s top-level bounds
check (`remaining.lessThanOrEqualTo(0)` → "already refunded in full") runs
*before* the idempotency-replay lookup, using the *current* (post-claim)
`payment.refundedAmount`. For a **full** refund (amount omitted, defaulting
to "whatever remains"), a legitimate retry of the *exact same request* with
the *same* idempotency key — after the first attempt already fully claimed
the payment — gets rejected with "already refunded in full" instead of
transparently replaying the original result, because the bounds check fires
before the replay lookup is ever reached. This is **pre-existing behaviour,
not introduced by this pass** (confirmed: it existed identically in the code
this pass started from), bounded in impact (the retry fails loudly rather
than double-refunding — no money-safety violation, just a confusing error on
an edge case), and only reachable when a caller omits `amount` for a full
refund and retries with the identical key after already succeeding. Recorded
here per the brief's demand for full disclosure; not fixed in this pass to
keep to what P0–P2 actually required, but worth a follow-up.

## 3. Files changed, grouped by finding

**P0 — PSP refund confirmation boundary:**
- `apps/api/prisma/schema.prisma` — `RefundPspStatus` enum, four new `Refund` columns.
- `apps/api/prisma/migrations/20260819190000_refund_psp_confirmation_boundary/migration.sql` — additive migration.
- `apps/api/src/modules/payments/psp-adapter.interface.ts` — `refund()`/`checkRefundStatus()`, `PspRefundRequest`/`PspRefundResult`.
- `apps/api/src/modules/payments/refund-engine.service.ts` — full rewrite of the finalize path around the PSP boundary; `reconcilePendingRefunds()`.
- `apps/api/src/modules/payments/sandbox-psp.adapter.ts` — `refund()`/`checkRefundStatus()`, `SANDBOX_REFUND_TRIGGERS`.
- `apps/api/src/modules/payments/refunds.controller.ts` — `pspStatus` in the audit metadata.
- `apps/api/test/refund-psp-confirmation.int-spec.ts` — new, 12 tests.

**P0 follow-up — sweep gating regression:**
- `apps/api/src/modules/sweeps/sweeps.jobs.ts`, `sweeps.module.ts` — `cardPaymentsEnabled` gate.
- `apps/api/test/production-boot.int-spec.ts` — new test D.
- `apps/api/test/sweeps.int-spec.ts`, `apps/api/test/alerting.int-spec.ts` — `refunds` field added to the stubbed `SweepDependencies` bundles (mechanical, no behavior change).

**P1 — pool-split reconciliation:**
- `apps/api/test/purchase-intents.int-spec.ts` — new test only, no source change.

**P2 — trust proxy:**
- `apps/api/src/main.ts`, `apps/api/src/config/configuration.ts`.
- `apps/api/src/config/trust-proxy.ts`, `trust-proxy.spec.ts` — new.
- `apps/api/.env.example` — `TRUST_PROXY` documented.

**Documentation:**
- `docs/DEPLOYMENT.md` — `TRUST_PROXY` operational note.
- `docs/HARDENING_AUDIT_2026-08-19-P0-P3.md` — this document.
- `docs/HARDENING_AUDIT_2026-08-16.md` — dated summary entry appended.

## 4. Tests added/changed and exact commands run

New/changed test files:
- `apps/api/test/refund-psp-confirmation.int-spec.ts` (new, 12 tests)
- `apps/api/test/production-boot.int-spec.ts` (+1 test, "D")
- `apps/api/test/purchase-intents.int-spec.ts` (+1 test, pool-split reconciliation)
- `apps/api/src/config/trust-proxy.spec.ts` (new, 8 tests)
- `apps/api/test/sweeps.int-spec.ts`, `apps/api/test/alerting.int-spec.ts` (mechanical fixture updates)

Commands, in the order they were actually run this pass:

| Command | Result |
|---|---|
| `npx jest --selectProjects integration --testPathPattern purchase-intents --testTimeout=30000` (before any change) | PASS — 39/39, confirming P1 atomicity already fixed |
| `npx jest --selectProjects integration --testPathPattern "refund-psp-confirmation"` | PASS — 12/12 (after the fix) |
| `git stash push -- .../refund-engine.service.ts` + same command | **FAIL to compile** — `RefundPspStatus`/`reconcilePendingRefunds` do not exist on the pre-fix file, proving the tests are real |
| `git stash pop` + same command | PASS — 12/12 |
| `npx jest --selectProjects integration --testPathPattern "refund\|payment\|sweeps\|settlement\|payout\|acquirer"` | PASS — 171/171 (13 suites) after the P0 fix |
| `npx jest --selectProjects integration unit --testPathPattern "production-boot\|auth-otp\|auth\\.\|rate-limit"` | Surfaced the sweep-gating regression (2/24 failing) |
| Fixed sweeps gating; `npx jest --selectProjects integration --testPathPattern "production-boot"` --verbose | PASS — 4/4 including new test D |
| `npx jest --selectProjects integration --testPathPattern "refund\|payment\|sweeps\|settlement\|payout\|acquirer\|production-boot"` | PASS — 175/175 (14 suites) |
| `npx jest --selectProjects unit --testPathPattern "trust-proxy"` | PASS — 8/8 |
| (temporarily removed `trust-proxy.ts`) same command | **FAIL to compile** |
| restored; same command | PASS — 8/8 |
| `npx jest --selectProjects integration --testPathPattern "self-dealing\|qr-payments\|ev-charging\|ev-cdr-reconciliation\|ocpi"` | PASS — 73/73 (verifying P1 self-dealing/QR/EV) |
| `npx jest --selectProjects integration --testPathPattern "partner-integrations"` | PASS — 21/21 (verifying P2 integration-activation-type) |
| `npx jest --selectProjects integration --testPathPattern "purchase-intents\.int-spec" -t "reconciles green"` | PASS — 1/1 (new reconciliation test) |
| Temporarily reverted `tutakBase` to independent rounding; same command | **FAIL** — exact predicted ledger-imbalance exception, proving the test is meaningful |
| Restored (`git diff` clean); `npx jest --selectProjects integration --testPathPattern "purchase-intents\.int-spec"` | PASS — 40/40 |
| `npx tsc --noEmit -p tsconfig.spec.json` (apps/api) | PASS |
| `npx tsc --noEmit -p tsconfig.build.json` (apps/api) | PASS |
| `npx eslint src test` (apps/api) | PASS — 0 problems |
| `npx nest build` (apps/api) | PASS |
| `npx prisma migrate status` (`tutak_test`) | "Database schema is up to date!" |
| `npx prisma migrate deploy` (`tutak`, dev DB) | Applied cleanly, no drift |
| `npx jest --selectProjects integration unit --testTimeout=30000 --forceExit` (apps/api, full suite, final, run in isolation — no concurrent process touching the test DB) | **PASS — 974/974, 69/69 suites** |
| `npx jest` (apps/mobile) | PASS — 203/203, 23/23 suites |
| `npx jest` (apps/admin) | PASS — 29/29, 5/5 suites |
| `npx jest` (apps/partner) | PASS — 16/16, 2/2 suites |

An earlier attempt at the full apps/api suite produced 16 spurious failures
(Postgres deadlocks, `40P01`, from `truncateAll`'s `TRUNCATE ... CASCADE`
racing against another test process this session had left running
concurrently against the same local database) — a sandbox artifact of
running two `jest` invocations against one Postgres instance at once, not a
regression. Re-run in isolation (nothing else touching the DB): clean,
974/974. Recorded here rather than silently discarded, per the standing
instruction not to suppress or hide a failing result.

## 5. Full test/build/typecheck results

| Suite | Result |
|---|---|
| apps/api integration + unit | **974/974 passed, 69/69 suites** |
| apps/api typecheck (spec + build configs) | PASS |
| apps/api lint (`eslint src test`) | PASS — 0 problems |
| apps/api build (`nest build`) | PASS |
| apps/api migrations (`tutak_test` and `tutak` dev DB) | Up to date, no drift, applied cleanly |
| apps/mobile | 203/203 passed, 23/23 suites |
| apps/admin | 29/29 passed, 5/5 suites |
| apps/partner | 16/16 passed, 2/2 suites |

Not run this pass: the Playwright `tests/e2e/` suite and a live Docker
boot — see §7, `NOT VERIFIED`.

## 6. Remaining risks

- **No CRITICAL or HIGH risk identified as still open.** P0 is fixed and
  tested; every P1 item is either already fixed (with passing regression
  tests re-confirmed on current HEAD) or newly test-covered.
- **MEDIUM:** none newly identified as open. The one item this pass
  deliberately left open (P2's webhook/CDR trust boundary) is genuinely
  **not reproducible** rather than deferred — there is no live surface to
  exploit today, and the moment a real trusted-integration-event endpoint
  is built (§M item 8 of `docs/HARDENING_AUDIT_2026-08-16.md`, still
  deliberately not built), this exact question needs re-asking against
  that endpoint's actual authentication design.
- **LOW:** the `refund()` bounds-check-before-replay-lookup quirk on an
  omitted-amount full refund, §2 above — not fixed, bounded impact, worth a
  follow-up.
- **LOW:** `refund-payout-key-durability.int-spec.ts`/similar crash-recovery
  suites simulate a lost `IdempotencyRecord`, not an actual process
  restart — this repo has no harness that kills and restarts the Node
  process mid-request, so "retry after process crash" is proven at the
  granularity this codebase has always proven it at (a lost durability
  record, the actual failure mode a crash produces), not by literally
  killing `node`.

## 7. Items marked `NOT VERIFIED`

- **Live Docker Compose boot.** This sandbox's outbound network policy
  blocks Docker registry pulls (pre-existing constraint, documented in
  `docs/LAUNCH_READINESS_2026-08-16.md` §I.5) — all verification this pass
  ran against natively-installed Postgres/Redis and directly-invoked
  `node`/`jest`, not the full `docker-compose` stack. No bearing on GitHub
  Actions CI (real registry access there) or a real deployment target.
- **Playwright `tests/e2e/` suite** (`loyalty-loop.e2e.ts`,
  `money-movement.e2e.ts`, `mobile-demo.e2e.ts`) was not run this pass —
  it requires building and booting the admin/partner Next.js apps and the
  API together, which this pass's time budget went to the API-level
  integration suite instead (974 tests, the layer every finding in this
  brief actually lives at). Recommend running it before the next real
  deploy, unchanged by this pass's diff.
- **A live re-run of the 2026-08-19 pentest's rate-limit-bypass PoC**
  against a booted server with a spoofed `X-Forwarded-For` header. The
  trust-proxy fix was verified by direct inspection of the installed
  `express`/`proxy-addr` package source (confirmed `typeof val === 'string'`
  never receives hop-count treatment, and `proxyaddr.compile('1')` compiles
  but trusts nothing) plus unit tests of the decision function — not by
  literally re-running curl against a live process with a forged header,
  which this pass's time budget did not extend to.
- **Exhaustive enumeration of every `:id` route in the codebase for IDOR**,
  beyond the dedicated `idor-sweep.int-spec.ts`/`partner-tenant-isolation
  .int-spec.ts`/`authorization.int-spec.ts` suites (149 tests across the
  three) and this pass's own spot checks of ~10 controllers. Those suites
  describe themselves as systematic sweeps of "every route... not already
  covered elsewhere," which this pass takes at face value rather than
  independently re-deriving.

## 8. Launch verdict

**READY FOR INDEPENDENT AUDIT.**

Not "secure" and not "fully tested" as unconditional claims — see §6/§7 for
what remains open or unverified. What this verdict means concretely: the
one CRITICAL finding in the brief (PSP refunds not actually moving money
before being recorded complete) is fixed, tested against the specific
failure modes the brief enumerated (decline, timeout/unknown, PSP-success-
then-local-crash, duplicate/concurrent requests, cumulative-cap-while-
pending), and verified with a git-stash proof that the new tests fail
against the pre-fix code. Every P1 item was independently re-verified
against current HEAD rather than trusted from the historical issue
comments — three were already fixed and are now backed by tests re-run and
re-confirmed on this exact HEAD, and the fourth (economics reconciliation)
gained the specific rounding-boundary regression test the brief asked for,
verified meaningful by temporarily reintroducing the historical bug pattern
and watching it fail. P2's one live, confirmed gap (the pentest's
X-Forwarded-For finding) is fixed and unit-tested against the actual
`express`/`proxy-addr` mechanics, not merely against this codebase's own
assumptions about them. The full API test suite (974 tests, 69 suites) and
all three frontend suites (mobile/admin/partner) pass; typecheck, lint, and
build are clean; both databases this pass touched are migration-current
with no drift.

No CRITICAL or HIGH risk is left open. The gaps that remain (§6/§7) are a
genuinely-not-reproducible P2 item, one disclosed LOW-severity pre-existing
quirk, and verification depth this pass's time budget did not extend to
(a live Docker boot, the Playwright e2e suite, and a literal curl-based
pentest re-run) — none of which block independent re-audit, all of which
are named explicitly rather than silently assumed clean.
