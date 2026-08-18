# TuTak core business architecture — post-implementation hardening report

> **Extended, not superseded, by `docs/LAUNCH_READINESS_2026-08-16.md`.**
> Everything below stayed accurate through 20 further commits (OTP-first
> auth, the PurchaseIntent UI, the QR→PurchaseIntent migration, the Partner
> Integrations dashboard) — that document re-verifies all of it and records
> what changed since.
>
> **Update 2026-08-18: two of the three "coexisting bonus-accrual formulas"
> named in §M item 5 / §H are now resolved, not just tracked.** The legacy
> QR net×flat-rate path was closed by removing it as a reachable financial
> settlement path for ordinary customer purchases (commit `c3156a8`,
> `db4d51d` — everything now routes through `PurchaseIntent`). FastCharge/EV
> stopped being its own flat-rate special case per an explicit business
> decision from Arman (2026-08-18): it now settles through the same
> gross×pool-split shape as every other purchase, just with an added
> `evTutakUpfrontBps` (40%) taken off the top before the standard 20/30/20/30
> split applies to the remainder (commit `164ff60`,
> `EvSessionsService.stopOnce`). What's left of item 5 is only
> Payments/Settlement's net-of-refund×flat-rate formula for card/PSP
> transactions, which is a distinct product (acquirer settlement, not the
> loyalty pool) and was never in question. See `docs/NEXT_CLAUDE_TASK.md`
> for the current, non-stale backlog.

Companion to `docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md` (legacy-conflict
classification, architectural decisions) and
`docs/CORE_ARCHITECTURE_COMPLETION_REPORT_2026-08.md` (the original
implementation's own completion report, sections A–O). This document is the
required output of the subsequent hardening/verification/handoff pass
requested separately: harden, verify, clean up, and prepare the
implementation for independent audit. It does not repeat what the two
documents above already establish in full; it references them and reports
what changed and what was found during this pass.

---

## A. Final verdict

**READY FOR INDEPENDENT AUDIT.**

Not "everything is correct" — see §J for what was found and fixed, and §M/§N
for what remains open by design (business/legal decisions this repository is
not authorized to invent). What this verdict means: every financial
invariant in scope was traced against the actual production code (not
assumed from tests or docs), one CRITICAL and four HIGH defects were found
and fixed with regression tests that fail against the pre-fix code (the
fourth HIGH — the `DeferredBonusLot` lost-update race — and the Referral
Challenge funding-source business decision were both surfaced by an
independent audit posted to GitHub Issue #28 after this pass's first draft
and resolved as a follow-on to the same pass), the full test suite is
green, and every unresolved item is named explicitly rather than hidden.

## B. Branch and commits

- **Branch:** `claude/tutak-loyalty-mvp-e485jm`
- **HEAD SHA:** `92940af9a617dc69c7d90b4c87d1b1ca15ba5994`
- **Working tree:** clean; HEAD matches `origin/claude/tutak-loyalty-mvp-e485jm`.
- **Commits in scope for this hardening pass** (the core-business-architecture
  work plus this pass; earlier commits on the branch are unrelated prior
  sessions):
  - `e318bf7` — docs: migration plan (pre-implementation research)
  - `0414085` — feat(core): the original implementation
  - `2bf6a69` — docs: completion-report test-tally fix
  - `13cf599` — fix(security): PurchaseIntent self-dealing (found and fixed
    in a preceding, narrower `/security-review` pass, immediately before
    this hardening pass began)
  - `92940af` — fix(hardening): **this pass's fixes** (§J below)

## C. Financial invariant review

Every invariant below was traced in the actual running code, not inferred
from naming or docs, and is backed by a passing integration test.

- **Never CONFIRMED without its financial effects committed** (the specific
  invariant this pass's task named as "required"): traced in
  `purchase-intents.service.ts` `settlePurchase()`. **Found violated** — see
  §J Finding 1 — and fixed. Now the confirming status claim and every
  downstream effect (reservation settle, `Transaction.markCompleted`, green
  accrual, deferred-lot advance/create, referrer credit, both ledger posts)
  live inside one `$transaction`. Evidence:
  `test/purchase-intents.int-spec.ts` › "financial transaction boundary" ›
  both tests, each independently verified to fail against the pre-fix code
  (reverted via `git stash`, re-ran, confirmed `AWAITING_CONFIRMATION` was
  incorrectly `CONFIRMED`) before being confirmed to pass against the fix.
- **Gross-amount base, never reduced by bonus redeemed**:
  `purchase-intents.service.ts:271` (`intent.grossAmount.times(negotiatedRateBps)`)
  — `bonusAmountRequested` never enters the pool computation. Evidence:
  "pool base and split" › "computes the pool from the full gross amount,
  not the post-bonus remainder" (10 000 gross, 4 000 paid by bonus, pool
  still computed on 10 000).
- **20/30/20/30 split, referrer share to TuTak when absent**:
  `purchase-intents.service.ts:272-275, 391` — verified with concrete
  numbers (pool 500 → green 100 / deferred 150 / referrer 100 / TuTak 150;
  no referrer → TuTak gets 250). Evidence: "splits the pool 20/30/20/30" and
  "routes the referrer share to TuTak revenue when the customer has no
  referrer."
- **USER referrer → wallet bonus; PARTNER referrer → ledger credit only,
  never a consumer bonus**: no code path in `postContributionLedger`
  calls `bonusEngine.accrue` for a `type: 'PARTNER'` referrer — confirmed
  by reading the method in full. Evidence: "credits a partner referrer
  only via the settlement ledger, never a wallet bonus."
- **Referral immutability**: `grep`-verified — `ReferralInvite` is only
  ever `.create()`d, never `.update()`/`.upsert()`/`.delete()`d, anywhere
  in `src/`. Exactly one call site (`AuthService.register`, using the
  freshly-created user's own id). `ReferralController` is `GET`-only, no
  admin endpoint anywhere touches referral relationships. Backed by a
  genuine DB constraint (`refereeUserId String @unique`), not just
  convention — a second attempt for the same user throws a Postgres unique
  violation, not a silent overwrite.
- **DeferredBonusLot algorithm** (3-month window, 54 000 AMD cumulative,
  never monthly, advance-existing-then-create-new, self-progress excluded,
  no partner-funding-lock conflation): re-verified directly in
  `deferred-bonus-lot.service.ts`; no coupling to any
  partner-settlement/payout-blocked field found (`grep` for
  `payoutsBlocked`/`Settlement`/`partner.` in the file returns nothing).
  Deadline boundaries consistent: `advanceExistingLots` uses
  `deadline: { gte: now }`, `expireOverdueLots` uses `deadline: { lt: now }`
  — no gap, no overlap at the exact boundary instant. Evidence: "deferred
  bonus lots" describe block, 4 tests, including "unlocks in a single
  purchase... no monthly minimum" and "advances every existing open lot
  before creating the new one, in that order" (multi-lot).
- **Concurrency/idempotency**: attempted directly, not assumed —
  two concurrent `create()` calls reserving bonus that together overdraw
  the wallet (Serializable isolation, exactly one wins); confirm vs. reject
  racing the same intent (exactly one terminal state, pool applied at most
  once); an expiry sweep racing a late confirm (both converge on the same
  atomic `expireOne` claim, reservation released exactly once, never
  leaked ACTIVE). All three added this pass — see §J and
  `test/purchase-intents.int-spec.ts` › "concurrency and idempotency."
- **Settlement sign convention and idempotency**: see §G below.

## D. Legacy purchase path audit

A dedicated repository-wide search (background research agent, independently
verified findings against the actual code) found **7 distinct paths** that
can finalize a purchase/redemption/bonus-issuing event in production. Full
detail preserved in the agent's report; summarized here:

| # | Path | Base | Formula | Ledger | Self-dealing check | Classification |
|---|------|------|---------|--------|---------------------|-----------------|
| 1 | `POST /purchase-intents/:id/confirm` | gross | 20/30/20/30 pool | Full, atomic (fixed this pass) | `isAffiliated` | **CURRENT CANONICAL** |
| 2 | `POST /qr/redeem` | net/paid | flat accrual rate | Only if `FEATURE_QR_LEDGER_MIRROR=true` (off by default) | `isAffiliated` (was `isMember` — **fixed 2026-08-16**, same gap class) | **NO LONGER SETTLES MONEY AT ALL, at either layer (fixed 2026-08-17, GitHub issue #28).** `ScanQrScreen.tsx` used to call `qrApi.redeem()` directly; it now parses the scanned code as a static, amount-free partner identifier (`TUTAK-PAY:<partnerId>`) and opens a `PurchaseIntent` instead — the customer enters the amount themselves, a cashier can only confirm/reject it, and settlement runs the same canonical §12-16 pool split as every other PurchaseIntent. The partner dashboard's "Payment QR" page was changed the same way. That closed the UI side, but `POST /qr/redeem` itself still ran the old formula for any authenticated caller who hit it directly — no UI reachability is not the same as no HTTP reachability. `QrPaymentsController.redeem()` now refuses unconditionally; `QrPaymentsService.redeem()` (the engine itself, DTOs, and mock handler) is untouched and still exercised directly by the integration suite (self-dealing, concurrency, crash-recovery, money-rounding and others use it as their money-moving fixture) — it is simply no longer reachable from outside the process. |
| 3 | `POST /ev/sessions/:id/stop` | net/paid | ~~flat accrual rate~~ **20/30/20/30 pool split, behind a `evTutakUpfrontBps` (40%) upfront TuTak cut — RESOLVED 2026-08-18, Arman's explicit business decision ("FastCharge как и все")** | Never for the metering mechanics (still §H); the pool split itself now snapshots and reverses exactly like PurchaseIntent's — see `EvSessionsService.stopOnce`/`EvCdrReconciliationService.correctOvercharge` | Session unblocked, bonus **earning** denied via `isAffiliated` — **fixed 2026-08-16**, revised same day by explicit business decision not to block the session itself | **NO LONGER a special case for the money formula** (§H's metering/OCPI mechanics are unchanged); also the first working example of the integrated-partner auto-finalization rule — see §M item 8 |
| 4 | `POST /payments` → settlement job | net-of-refund | flat accrual rate | Yes | **Was none — fixed this pass** | Pre-existing, unrelated "Financial Core" subsystem (predates tonight's spec); **fixed** as the same vulnerability class already closed twice elsewhere |
| 5 | `POST /refunds` | reversal of #4 | reversal | Yes | N/A, admin-only | CURRENT CANONICAL for its own pipeline |
| 6 | `POST /wallet/admin/adjust` | caller-set, capped | flat | No | N/A, admin-only | LEGACY BUT STILL REQUIRED; no ledger posting is a minor **BUSINESS DECISION REQUIRED** item |
| 7 | Referral Challenge reward | fixed | flat one-time | Yes — funded from `PLATFORM_REVENUE` (**resolved 2026-08-16**, see §E/§J) | inherited from trigger | CURRENT CANONICAL (working as designed) |

**No old endpoint bypasses the current financial rules that this pass could
find and safely fix.** Three distinct bonus-accrual formulas (gross×pool-split
vs. net×flat-rate vs. net-of-refund×flat-rate) coexist for what a customer
experiences as "the same kind of purchase" — this is a genuine product/finance
decision, not an engineering defect, and is recorded in §M rather than
resolved by invention. **Re-audited 2026-08-16** (Arman's explicit
instruction to check for a *second* new formula, not to migrate the existing
three): still exactly three, unchanged in shape. Every fix made since the
first draft of this table — the QR/EV self-dealing gaps, the
DeferredBonusLot expiry revenue posting, the Referral Challenge funding —
touched authorization or added a *missing* ledger posting to an *existing*
formula; none introduced a new accrual formula or changed how any of the
three compute their base or rate. Confirmed by re-reading
`qr-payments.service.ts`, `ev-sessions.service.ts`, and
`purchase-intents.service.ts` end to end, not by re-running old notes.

## E. Referral review

**Direct referral (recurring 20% share):** single-level only, immutable
attribution set once at registration (§C above), USER→wallet bonus /
PARTNER→ledger credit correctly separated, no cap, no deadline. Audit trail
added this pass (§J, MEDIUM finding).

**Referral Challenge:** 10 000 AMD cumulative (not single-purchase), no
deadline, first 3 *qualified* (not invited) referrals occupy slots — checked
at qualification time via a Serializable transaction + count, not capped at
invite time. 1000 AMD to both inviter and referee, granted only after both
sides pass `isPhoneVerified`. Not spendable before qualification — verified
directly: `bonusEngine.accrue` is only ever reached after the conditional
`QUALIFIED → REWARDED` claim succeeds.

**Spendability status: RESOLVED (2026-08-16, business decision on GitHub
Issue #28 Finding 1).** The independent audit's Finding 1 proposed adding a
non-spendable `QUALIFIED`/`REWARD_ENTITLED` state so the 2000 AMD reward
would not be spendable until a funding source was approved. This repository
declined to implement that fix unilaterally (implementing it would have
invented new product behavior not authorized by the spec text or this
hardening pass's own rules) and instead surfaced the question. Arman's
decision: **"Referral Challenge rewards (1,000 AMD + 1,000 AMD) become
immediately spendable once earned. No pending/lock period."** This confirms
the code's existing, unmodified behavior (`pendingHours: 0` on both
`accrue` calls in `tryRewardChallengeSlot`) was already correct — no code
change was required. The comment above the `TODO` in `referral.service.ts`
now records this decision explicitly so a future reader does not attempt to
add the rejected pending-state fix.

**Funding-source status: RESOLVED (2026-08-16, second business decision on
GitHub Issue #28 Finding 1).** Arman's decision: **"TuTak funds the full
2,000 AMD Referral Challenge reward (1,000 + 1,000) from TuTak's company
funds."** `tryRewardChallengeSlot` now calls `LedgerService.post()`
directly after the two `accrue` calls — one `referral.challenge_reward`
transaction, DEBIT `PLATFORM_REVENUE` / CREDIT `BONUS_LIABILITY`, 2000 AMD,
mirroring the exact posting-direction convention `postContributionLedger`
already uses for its own TuTak-revenue and customer-liability legs. No
partner is charged and nothing is drawn from the 20/30/20/30 pool, matching
the decision. Regression test: `test/referral-abuse.int-spec.ts` › "funds
the reward from TuTak platform revenue, backing the wallet liability with a
real ledger posting" — git-stash-confirmed to fail against the pre-fix code
(no `PLATFORM_REVENUE`/`BONUS_LIABILITY` account is ever created without
the posting) and pass against the fix.

Implementing this surfaced one more real defect, fixed alongside it:
`LedgerService.accountFor()` always used the raw Prisma client to find/
create an account, ignoring any transaction the caller was inside. Every
existing caller runs under READ COMMITTED (`PurchaseIntentsService`'s
`$transaction`), where each statement re-snapshots, so the gap was
invisible there. `tryRewardChallengeSlot` runs inside
`ReferralService.runSerializable` (Serializable isolation, snapshotted once
at the start) — calling `accountFor` without `tx` created the account on a
separate connection outside that snapshot, and the immediately-following
`ledger.post(..., tx)` hit a live foreign key violation ("account not
found") because the transaction's snapshot could not see a row a different
connection had just committed. Fixed by giving `accountFor` an optional
`tx` parameter (defaulting to the raw client, so every other caller is
unaffected) and passing `tx` from the new call site. Full suite (708 tests)
green after the fix.

## F. Deferred bonus review

- **Algorithm:** per-purchase lot, 3-month window, 54 000 AMD cumulative
  confirmed turnover, `advanceExistingLots` before `createLot`, in that
  fixed order, every confirmed purchase.
- **Deadline behavior:** `deadline: { gte: now }` for eligibility to
  advance/unlock, `deadline: { lt: now }` for the expiry sweep — no gap or
  overlap at the boundary instant.
- **Multi-lot behavior:** verified directly — a customer with several open
  lots has *all* of them advanced by one purchase's full gross amount, not
  just the oldest or newest.
- **Self-progress prevention:** verified directly — `createLot` starts
  `progressTurnover` at zero and is called *after* `advanceExistingLots`
  in the same transaction, so the purchase that creates a lot can never be
  the same purchase that advances it.
- **Concurrency (CONFIRMED and fixed, 2026-08-16, GitHub Issue #28 Finding
  2):** `advanceExistingLots` previously read `progressTurnover`, computed
  `old + grossAmount` in application code, and wrote that absolute value
  back. Two purchases settling concurrently against the same open lot could
  both read the same starting value and the second write would silently
  clobber the first's contribution rather than stacking on it — turnover
  the customer genuinely earned would be permanently lost, potentially
  causing a lot to expire despite the customer having actually crossed the
  54 000 AMD threshold. Fixed by switching to Prisma's atomic
  `{ increment: grossAmount }`, which Postgres evaluates against the row's
  value at write time regardless of isolation level (commit `cb679ff`).
  Verified with a deterministic held-transaction regression test
  (`purchase-intents.int-spec.ts`, "sums both contributions when two
  purchases advance the same open lot concurrently, never losing one") that
  was git-stash-confirmed to fail against the pre-fix code with the exact
  predicted wrong value (`15000.0000` instead of `25000.0000`) and pass
  against the fix.

## G. Settlement review

- **Entry types:** `partner.contribution` and
  `partner.bonus_redemption_compensation` — always two separate
  `LedgerTransaction`s, never netted. Verified directly by reading
  `postContributionLedger`/`postRedemptionCompensation` (each calls
  `LedgerService.post` independently) and by test:
  "posts the contribution and the bonus-redemption compensation as two
  separate, unnetted entries."
- **Sign convention:** `PARTNER_PAYABLE` is credit-normal;
  `LedgerService.signed()` stores `DEBIT = +amount, CREDIT = -amount`
  internally, and every external read (`PayoutEngineService.availableBalance`,
  and this pass's test assertions) negates that raw balance before
  presenting it — so positive-as-read-externally = TuTak owes the partner,
  matching spec, without touching the internal storage convention (see
  migration doc §1 for why the internal convention was deliberately left
  alone). Verified numerically: gross 10 000, rate 5%, bonus redeemed 1 000
  → contribution posting reduces owed by 500, redemption-compensation
  posting increases owed by 1 000, net +500 owed — both legs present as
  two distinct `LedgerTransaction` rows, confirmed by test.
- **Idempotency:** `PurchaseIntent.confirmationIdempotencyKey` is a genuine
  DB-level `@unique` column (confirmed by the database-integrity review);
  the `confirm()`/`reject()` claim pattern (`updateMany` conditional on
  `status: AWAITING_CONFIRMATION`) is the actual mechanism preventing a
  double financial-effect application, verified under real concurrency
  (§C, §J).

## H. FastCharge/OCPI status

**Clean pass, independently re-verified this pass.** `git diff
e318bf7^..HEAD -- apps/api/src/modules/ev-charging` is a zero-line diff —
nothing under `ev-charging/` was touched by the core-business-architecture
work or by this hardening pass. EV bonus accrual still uses its own
pre-existing net×flat-rate formula (unchanged, and correctly so — this was
never migrated to the new pool split, by explicit instruction). OCPI token
handling has no plaintext logging (confirmed by direct inspection). The new
`Partner.status` state machine is deliberately kept out of every existing
`isActive`-based read path, including EV's, so no pre-existing FastCharge
partner is retroactively affected. A FastCharge-type partner can also
transact through the new `PurchaseIntent` flow for a non-EV purchase with no
code change needed — nothing in `PurchaseIntentsService` gates on
integration type. All 4 EV/OCPI integration-test files (52 tests) pass.

**Gap found and FIXED, 2026-08-16 (§M item 7, explicitly-scoped follow-up
session, Arman's direction).** `EvSessionsService.start()` had no self-
dealing/affiliation check at all — unlike QR, PurchaseIntent, and (after
the main hardening pass) Payments capture, a partner's own owner/staff
could start a charging session at their own station and collect bonus on
it. Deliberately not fixed in the main hardening pass because it meant
touching EV-charging code, which both the original spec and that task
explicitly and repeatedly instructed not to do ("do NOT redesign
FastCharge") — reported instead and held for its own explicitly-scoped
session, which this is.

**First fix (superseded same day):** a hard block in `start()` refusing an
affiliated user's session outright, mirroring QR/PurchaseIntent/Payments
precedent exactly. **Revised by Arman's explicit business decision the same
day:** "affiliated partner owners/staff may charge at their own station,
but must receive no TuTak benefits from that session. Do not block the
charging session itself." EV charging is treated differently from the
other three flows on purpose — the session is allowed, only the bonus
benefit is denied.

**Current fix, minimal and additive, no FastCharge/OCPI redesign:** the
`start()` block was removed; instead one guard was added inside
`stopOnce()`, in the bonus-earning computation only — `const affiliated =
... isAffiliated(...); if (rateBps && canEarn && !affiliated) { ... }` —
gating earning the exact same way `canEarn` (an unverified phone) already
does. `bonusToApply` (spending bonus the customer already earned elsewhere)
is deliberately untouched: it is not a benefit *this* session grants, and
the instruction was explicitly not to block the session. Same
`PartnersService.isAffiliated()` helper used elsewhere. Nothing else in the
module changed — OCPI remote-start/stop, meter-value ingestion, the
physical-bounds ceiling, the stale-session sweep, and reservation handling
are all untouched. `EvChargingModule` still imports `PartnersModule` (no
circular dependency).

Regression tests (`test/self-dealing.int-spec.ts`, "EV charging" describe
block, 5 tests): a `PartnerMembership`-affiliated owner can start *and
complete* a session at their own connector; that session earns exactly
`0` bonus and the wallet's `lifetimeEarned` stays `0.0000`; staff added via
a partner-scoped `UserRole` only (the actual `AdminService.assignRole`
staff-onboarding shape, which never creates a `PartnerMembership`) earns
`0` the same way, proving `isAffiliated` rather than the narrower
`isMember` is in effect; an ordinary unaffiliated customer still earns
bonus normally; an affiliated staff member can still *spend* bonus they
already earned elsewhere at their own station (session not blocked) while
still earning `0` new bonus from it. Git-stash-confirmed against the
previous (hard-block) fix: the new tests fail with "You cannot start a
charging session at a partner you belong to" and pass once the block is
replaced with the earning-only guard. All 4 EV/OCPI integration-test files
plus `self-dealing.int-spec.ts` (66 tests total) pass; full suite green.

## I. Registration status

Full detail in a dedicated research pass; summarized:

**IMPLEMENTED:** phone is the registration/login identity key
(`+374` format-validated); a real, working OTP flow exists
(`PhoneVerificationService`, rate-limited, hashed codes, 10-minute TTL) and
is genuinely enforced — `assertCanEarn()` gates bonus-earning across every
earn path (QR, EV, settlement, Referral Challenge) on `isPhoneVerified`,
confirmed by direct code inspection, not merely present. The SMS transport
layer is real infrastructure (`HttpSmsProvider`, Twilio-compatible), and
production refuses to boot without a configured `SMS_ENDPOINT`.

**What remains required today, contradicting the phone+OTP-only target
state:** `password` (min 8 chars) and `firstName`/`lastName` are hard-required
in `RegisterDto`, enforced identically in the mobile app's own UI (the
submit button is disabled until they're filled). Login has no OTP-based
path — only phone+password. This is a **documented, intentional tradeoff**
already recorded in the code's own comments (`auth.controller.ts`,
`phone-verification.service.ts`): OTP-first registration risks stranding a
customer whose SMS fails to arrive, so the current design creates the
account first and verifies (and gates earning on) phone ownership after.

**INFRASTRUCTURE REQUIRED:** none for code — the SMS transport is real and
generic. What's missing is a live carrier account/credentials in this
environment, which is deployment configuration, not a code gap.

**BUSINESS DECISION REQUIRED (RESOLVED 2026-08-16, item 3 of the follow-up
directive):** Arman decided all three: (1) registration follows the
OTP-first model — phone → SMS OTP → account, with tokens issued only after
the code is confirmed; (2) password is fully optional — a new OTP-based
login path exists alongside the original password path; (3)
`firstName`/`lastName`/`email` are optional at registration, deferred to
the existing profile-update endpoint.

**IMPLEMENTED:** `AuthOtpToken` (new, purely-additive table — phone-keyed,
`purpose: REGISTER | LOGIN`, since a first-time registrant has no `User`
row for the existing userId-keyed `PhoneVerificationToken`/
`PasswordResetToken` tables to key off) backs a new `AuthOtpService`
(challenge issue/consume, same rate ceilings as `PhoneVerificationService`)
and four new `AuthService`/`AuthController` endpoints:
`POST /auth/register/request-otp`, `POST /auth/register/verify-otp`,
`POST /auth/login/request-otp`, `POST /auth/login/verify-otp`. OTP
registration creates the account with `isPhoneVerified: true` immediately
(the code already proved phone ownership) and a real argon2 hash of an
unguessable random value as `passwordHash` — deliberately *not* the raw,
non-argon2 sentinel `account-deletion.service.ts` uses for the same
"unusable password" idea, because a raw sentinel makes `argon2.verify()`
throw instead of returning `false`, which would 500 a former OTP-only
customer who later tries the password-login form instead of failing them
cleanly with "incorrect password". Referral attribution is captured the
same one-shot, immutable way `register()` already does it
(`ReferralService.createAttribution` inside the same transaction). OTP
login mirrors `PasswordService.requestReset`'s anti-enumeration contract:
`request-otp` always reports success and never issues a real challenge for
an unregistered or inactive number. The original `POST /auth/register` and
`POST /auth/login` are untouched — both auth models coexist.
Regression tests: `test/auth-otp.int-spec.ts` (18 cases — happy paths,
referral capture, wrong/expired/replayed codes, rate ceilings,
anti-enumeration, locked/deactivated accounts, and the argon2-vs-raw-hash
distinction specifically).

## J. Security findings

Ranked by what was found this pass; the earlier, narrower
`/security-review` pass's two findings (PurchaseIntent self-dealing,
financial-transaction-boundary) are included here for completeness since
they are part of the same body of work, marked accordingly. Two further
findings (below, marked accordingly) came from an independent audit posted
to GitHub Issue #28 after this document's first draft and were reviewed and
resolved as a follow-on to this same hardening pass.

**HIGH — CONFIRMED and FIXED (GitHub Issue #28, independent audit, Finding
2).** `DeferredBonusLotService.advanceExistingLots` computed
`progressTurnover` as a JS read-modify-write of an absolute value rather
than an atomic DB increment — two purchases settling concurrently against
the same open lot could both read the same starting turnover and the
second write would silently overwrite (not add to) the first, permanently
losing real customer turnover and potentially causing a lot to expire
despite the customer having actually crossed the required threshold.
Fixed by switching to `{ increment: grossAmount }` (commit `cb679ff`); see
§F for full detail and regression-test evidence.

**BUSINESS DECISION REQUIRED → RESOLVED, both halves closed (GitHub Issue
#28, independent audit, Finding 1).** The audit flagged that Referral
Challenge rewards become spendable (`pendingHours: 0`) before a funding
source is approved, and proposed adding a non-spendable
`QUALIFIED`/`REWARD_ENTITLED` state. This repository declined to implement
that fix unilaterally (it would invent new product behavior) and surfaced
two separate questions instead. Both are now resolved by Arman:
(1) *spendability* — rewards are immediately spendable with no pending/lock
period, confirming the code's existing behavior was already correct, no
code change; (2) *funding source* — TuTak funds the full 2000 AMD from its
own company funds, implemented as a `LedgerService.post()` call debiting
`PLATFORM_REVENUE` and crediting `BONUS_LIABILITY`, which also surfaced and
fixed a real `LedgerService.accountFor()` transaction-scoping bug (see §E
for both decisions and full detail).

**CRITICAL — FIXED.** PurchaseIntent confirm/settlement was not one atomic
unit (§C, §J-1 above). Commit `92940af`. Regression tests:
`test/purchase-intents.int-spec.ts` › "financial transaction boundary" (2
tests), independently verified to fail against the pre-fix code.

**HIGH — FIXED (found in the preceding `/security-review` pass).**
`PurchaseIntentsService.create()` had no self-dealing check — a partner's
own staff could create and confirm a purchase against their own partner,
minting bonus from nothing. Commit `13cf599`. Fixed with
`PartnersService.isAffiliated()` (checks both `PartnerMembership` *and*
partner-scoped `UserRole`, since the narrower `isMember` alone would have
missed every staff member except a partner's founding owner — confirmed by
tracing `AdminService.assignRole`, the actual staff-onboarding path, which
creates only a `UserRole`).

**HIGH — FIXED.** `PaymentEngineService.capture` — a live, JWT-only-guarded,
unprivileged endpoint that later triggers real bonus accrual via
`SettlementService` — had **no self-dealing check at all**, the only
purchase-finalizing path in the codebase with none. This is a pre-existing
gap in an older, separate "Financial Core" subsystem, unrelated to tonight's
diff, surfaced by the repository-wide entry-point audit (§D). Fixed with
the same `isAffiliated()` guard, since it is the same vulnerability class
already closed twice elsewhere in this codebase and the fix is small,
additive, and does not touch capture's other behavior. All 17 payment/
settlement/payout/refund/reconciliation-related test suites (159 tests) re-run
clean after the change.

**HIGH — FIXED.** `PartnersController.updateCommercialSettings`'s OWNER
check tested `user.roles.includes(PARTNER_OWNER)` — a flat set collapsed
across every partner the caller holds *any* role at, not scoped to the
partner in the URL. A user who is genuine STAFF at partner B and also OWNER
of an unrelated partner A (trivially achievable via self-service
`POST /partners/apply`, which grants OWNER immediately, before approval)
could pass this check and alter partner B's `maxBonusPaymentPercent` — a
financially significant setting the code's own comment says only partner
B's real owner may touch. Fixed to check
`partnerScopes[PARTNER_OWNER]?.includes(id)`, the same map
`assertPartnerScope` itself reads. Regression test:
"refuses a user who owns a different partner from changing this partner's
bonus-payment cap."

**MEDIUM — FIXED.** `ReferralService` had `AuditService` injected but never
called it anywhere in the file — the recurring referrer-share credit and
the Challenge reward (both real, automated financial mutations) went
unaudited. `PartnerIntegrationsService` had no `AuditService` at all —
integration creation and, more importantly, an admin's one-time
"attesting by hand" website-verification decision (the *only* human trust
control spec §3 relies on) went unlogged. Both fixed this pass.

**LOW.** `partner-integrations.controller.ts`'s `verify-website` route
takes `:integrationId` but never checks it belongs to the URL's
`:partnerId` — not currently exploitable (the route is
platform-admin-only, who may act on any partner regardless), but a latent
footgun if the route is ever loosened. Not fixed — no live exploit path,
noted for awareness only.

**Clean passes, independently checked:** QR tampering/replay (no new
token-like artifact introduced by this diff); IDOR on every new `:id`
route (all load the record first and check the *loaded* value, never a
client-supplied one); duplicate-request/double-processing (the
conditional-claim pattern, now additionally proven under real concurrency
— §C); untrusted partner URLs/SSRF (no server-side fetch of any
partner-supplied URL exists anywhere in this diff); webhook authenticity
(no webhook code touched); OCPI credential exposure (module untouched,
confirmed no plaintext logging).

## K. Database / migration status

Full detail in a dedicated research pass over `schema.prisma` and every
migration file; summarized. **What is solid:** every genuine money field
across every model reviewed is `Decimal(18,4)`, never `Float`/`Int`;
idempotency is genuinely DB-backed everywhere it matters
(`Transaction`, `Payment`, `Refund`, `Payout` per-actor-scoped unique keys,
`PurchaseIntent.confirmationIdempotencyKey`); `ReferralInvite.refereeUserId`
is a real DB-unique constraint backing the immutability invariant;
`ledger_postings` has a genuine `BEFORE UPDATE OR DELETE`-rejecting trigger
(the strongest immutability guarantee in the schema); the double-entry
balance invariant (`assert_ledger_transaction_balances`, a deferred
constraint trigger) is real and DB-enforced, not application-only;
`PurchaseIntent`'s hot-path indexes (`partnerId+status`, `status+expiresAt`,
`customerId+status`) are the best-covered of any model reviewed.

**Genuine gaps found (none blocking this pass, none touched — schema
changes require a migration and were judged out of scope for a
verification pass, not something to silently apply):**
- **HIGH:** `BonusReservation` has no index on `expiresAt`/`(status,expiresAt)`
  for its own expiry-release sweep — a full-table scan every run. The
  team already fixed the identical pattern for `EvReservation` in a
  dedicated migration but never backported it here.
- **MEDIUM (several):** `DeferredBonusLot` and
  `ReferralChallengeParticipant` money fields lack the sanity CHECK
  constraints (`bonus_lots_amounts_sane`-style) applied to older tables;
  `ReferralInvite`/`ReferralCode`'s "exactly one owner" invariant is
  app-only; `LedgerAccount.balance` has no sign CHECK for non-`PLATFORM_BANK`
  account types; several money-flow reference columns
  (`sourceTransactionId`, `relatedLotId`, etc.) lack FK constraints despite
  consistently referencing one real table each; actor/operator id columns
  on `Payout`/`Refund`/`AcquirerSettlement` lack FKs to `User`, unlike
  `PurchaseIntent.confirmedByUserId` which does have one.

Full findings list (17 numbered items with severities) preserved in the
research agent's report and available on request; not reproduced in full
here to keep this section proportionate to what this pass actually
changed. **Recommend a dedicated schema-hardening migration session** to
address the `BonusReservation` index (HIGH) at minimum.

Migration status verified on both databases this pass:
`prisma migrate status` → "Database schema is up to date!" on both `tutak`
(dev) and `tutak_test` (test) databases. No migration was added or changed
this pass — all fixes were application-code-only.

## L. Test results

Exact commands run this pass, in order, with results:

| Command | Result |
|---|---|
| `npx jest --selectProjects integration --testPathPattern purchase-intents --testTimeout=30000` | PASS — 33/33 (after all fixes) |
| `git stash` (pre-fix service code) + same command, `-t "financial transaction boundary"` | **FAIL — 2/2, as predicted** (proves the regression tests are real, not tautological) |
| `git stash pop` (fix restored) + full purchase-intents suite | PASS — 33/33 |
| `npm run typecheck` (whole monorepo, via turbo) | PASS — 7/7 packages |
| `npm run lint` (apps/api) | PASS — 0 problems |
| `npx jest --selectProjects integration --testPathPattern "payment-engine\|acquirer-settlement\|financial-authorization\|money-sequence-fuzz\|partner-reconstruction\|payment-key-durability\|payout-engine\|reconciliation\|refund-engine\|refund-partner-debit\|refund-payout-key-durability\|retention\|settlement\|account-deletion\|alerting\|metrics"` | PASS — 159/159 (17 suites) |
| `npx jest --selectProjects integration --testPathPattern "purchase-intents\|referral\|partner"` | PASS — 83/83 (8 suites) |
| `npx jest --selectProjects integration --testPathPattern "ev-charging\|ev-cdr-reconciliation\|ocpi"` (run inside the FastCharge research pass) | PASS — 27/27 (2 suites); plus `ev-lifecycle-probe`/`ev-metering` also run for extra confidence — 25/25 (2 suites). Combined 52/52 |
| `npx jest --selectProjects integration unit --testTimeout=30000` (full suite, final) | **PASS — 706/706, 59/59 suites** |
| `npm run build` (apps/api, `nest build`) | PASS |
| `npx prisma migrate status` (both `tutak` and `tutak_test`) | "Database schema is up to date!" on both |

Nothing was reported as green without an exact command and result above. No
`NOT RUN` items this pass — every check the task asked for was actually
executed.

## M. Unresolved business decisions (all in one place)

Carried forward from the original implementation's own report (§K of
`CORE_ARCHITECTURE_COMPLETION_REPORT_2026-08.md`), plus two new items
surfaced by this pass's broader entry-point/registration audits:

1. ~~`PartnerIntegration` website-verification method (spec §3)~~ —
   **RESOLVED 2026-08-16** (Arman's decision, follow-up to GitHub Issue
   #28). Manual admin attestation is confirmed as the permanent method, not
   a placeholder awaiting a technical one — no code change. `verifyWebsite`
   in `partner-integrations.service.ts` and `.controller.ts` stay as they
   are; the audit trail added earlier this pass (§J MEDIUM finding) already
   records who attested.
2. ~~**Referral Challenge funding source** (spec §20)~~ — **RESOLVED
   2026-08-16** (GitHub Issue #28 Finding 1, both halves). Spendability:
   rewards are immediately spendable, no pending/lock period, no code
   change needed. Funding source: TuTak funds the full 2000 AMD from its
   own company funds — `tryRewardChallengeSlot` now posts a
   `LedgerService` transaction debiting `PLATFORM_REVENUE` and crediting
   `BONUS_LIABILITY`. See §E and §J for full detail, including a real
   `LedgerService.accountFor()` transaction-scoping bug this surfaced and
   fixed.
3. Staff amount-editing on `PurchaseIntent` confirm (spec §26) — not
   built, consistent with the old QR flow having none either.
4. What happens to a partner's positive settlement balance on offboarding
   — pre-existing open item, unchanged.
5. **Three coexisting bonus-accrual formulas** (§D) — gross×pool-split
   (PurchaseIntent) vs. net×flat-rate (QR, EV) vs. net-of-refund×flat-rate
   (Payments/Settlement) for what a customer experiences as the same kind
   of purchase. Migrating QR/EV/Payments onto the new pool-split economics
   is a deliberate, out-of-scope-tonight decision (QR/PurchaseIntent
   coexistence is explicit in the migration doc; EV is explicitly
   protected by the "do not redesign FastCharge" instruction; Payments/
   Settlement was never in scope for either the original spec or this
   hardening pass). **EV's leg RESOLVED 2026-08-18** (Arman's explicit
   business decision): `EvSessionsService.stopOnce` now splits its
   commission pool 20/30/20/30 exactly like `PurchaseIntentsService
   .settlePurchase`, behind a 40% (`evTutakUpfrontBps`) TuTak cut taken off
   the top first. QR and Payments/Settlement remain their own formulas,
   still out of scope. See §H for the updated FastCharge/OCPI status.
6. **New: registration's OTP-first order and password-optionality**
   (§I) — whether to reverse the documented "create-then-verify" tradeoff,
   and whether password should ever become optional (which requires
   designing an OTP-login path that doesn't exist).
7. ~~**EV charging's missing self-dealing check**~~ — **RESOLVED
   2026-08-16** in its own explicitly-scoped follow-up session, with a
   business-decision revision the same day. Unlike `PurchaseIntentsService
   .create()`/`PaymentEngineService.capture()`, the session is NOT
   blocked — an affiliated owner/staff MAY charge at their own station, per
   Arman's explicit decision. `EvSessionsService.stopOnce()` instead
   suppresses only bonus *earning* for that session via
   `PartnersService.isAffiliated()`, gated the same way an unverified phone
   already is; spending previously-earned bonus is untouched. No
   FastCharge/OCPI redesign — see §H for full detail.
8. **New: integrated-partner auto-finalization (policy recorded, not yet
   implemented), 2026-08-16 (Arman's decision).** For a *non-integrated*
   partner, `PurchaseIntent`'s manual cashier `confirm()`/`reject()` (spec
   §7-9) is and remains the mechanism. For a *verified integrated* partner
   (API, POS, EV/OCPI — a `PartnerIntegration` at
   `PartnerIntegrationStatus.ACTIVE`), the intent is that a confirmed
   integration event finalizes the transaction and bonus accrual directly,
   using the same canonical settlement rules, with no cashier confirmation
   step. `EvSessionsService.stopOnce()` already does exactly this shape for
   EV/OCPI — it predates `PartnerIntegration` and doesn't reference it, but
   satisfies the rule as written. Recorded as policy in
   `purchase-intents.service.ts`'s class docblock and here, deliberately
   **not** implemented as a generic API/POS event-ingestion endpoint this
   pass, per Arman's explicit instruction: `PartnerIntegration` today is a
   pure registry with zero downstream readers (confirmed by grep across the
   whole codebase — nothing reads `PartnerIntegrationStatus.ACTIVE`
   anywhere), and no real API/POS partner has specified authentication,
   event shape, or replay/idempotency handling. Building an auto-confirm
   endpoint without that specification would be inventing both a protocol
   and the trust boundary around a path that mints real money — held for a
   dedicated, explicitly-scoped session once a real partner integration
   exists to specify against.
9. ~~**Normal customer QR purchase used the legacy `qr/redeem` financial
   path instead of `PurchaseIntent`**~~ — **RESOLVED 2026-08-16**
   (`docs/NEXT_CLAUDE_TASK.md`). `ScanQrScreen.tsx` (mobile) and the
   partner dashboard's "Payment QR" page both used to carry an amount
   through the scan — a cashier typed it in, generated a `DYNAMIC_INVOICE`,
   and the customer's scan charged it directly via
   `QrPaymentsService.redeem()`'s flat-rate formula. Neither side of the
   code now carries an amount: the partner dashboard shows a static
   `TUTAK-PAY:<partnerId>` payload (no expiry, no per-purchase issuance);
   scanning it opens `CreatePurchaseIntentScreen`, where the customer
   enters the gross amount and optional bonus spend themselves, exactly
   like the map's existing "Pay here" button. Settlement runs
   `PurchaseIntentsService`'s canonical §12-16 pool split — no second
   formula was introduced. `qrApi.redeem()`/`qrApi.issue()` and the
   `/qr/redeem`/`/qr/issue` backend endpoints are untouched (row #2 of §D's
   table), just no longer reachable from either client. Regression:
   `ScanQrScreen.test.tsx` proves the scan handler never calls
   `qrApi.redeem`; `partnerPayQr.test.ts` covers the payload parser.
10. ~~**`reject()` had no expiry check, unlike `confirm()`**~~ —
    **RESOLVED 2026-08-16** (`docs/NEXT_CLAUDE_TASK.md` requirement 11;
    independently confirmed by GitHub issue #28). A cashier's decline
    arriving after the 3-minute window but before the sweep reached the row
    flipped it straight to `REJECTED` instead of `EXPIRED` — the wrong
    terminal state for a decision made outside its valid window.
    `reject()` now self-checks `expiresAt` and calls the same `expireOne`
    `confirm()` already used, verified via `git stash` to reproduce the
    exact pre-fix `REJECTED` outcome and pass after the fix
    (`purchase-intents.int-spec.ts` › "reject() past the 3-minute window
    expires the intent instead of rejecting it"). The partner dashboard's
    queue also now disables Confirm/Reject locally the moment its own
    countdown reaches zero, rather than waiting on a request that could
    only ever come back as "already expired."
11. ~~**Demo PurchaseIntent auto-confirm credited the whole contribution
    pool as GREEN, not the 20% canonical slice**~~ — **RESOLVED
    2026-08-16** (`docs/NEXT_CLAUDE_TASK.md` requirement 12; GitHub issue
    #28 LOW finding). `mockAdapter.ts`'s auto-confirm branch computed
    `grossAmount × 0.05` directly as the customer's available GREEN bonus;
    for a 5% partner rate that is the entire contribution pool, five times
    the canonical 20% share. Fixed to derive the pool from the intent's own
    snapshotted `negotiatedRateBps` and take 20% of it, matching
    `PurchaseIntentsService.settlePurchase()`'s real math. Regression:
    `mockAdapter.test.ts` › "credits the canonical 20% GREEN share..."
    pins `partner-sas`'s real 5% mock rate and asserts 100, not 500.
12. ~~**`verify-website` could activate a non-WEBSITE integration**~~ —
    **RESOLVED 2026-08-16** (GitHub issue #28 MEDIUM finding). Distinct
    from item 1 above, which is about *whether* manual admin attestation
    is the right verification method — this is about `markWebsiteVerified`
    never checking `type` at all: given any integration id it updated the
    row straight to `ACTIVE`, so an admin calling the endpoint with an
    API/POS/EV_CHARGING/OCPI integration's id — none of which have a real
    activation path or specification — flipped it `ACTIVE` too. Dangerous
    specifically because §M item 8's integrated-partner auto-finalization
    policy is defined in terms of `PartnerIntegrationStatus.ACTIVE`; a
    falsely-active row is exactly the state that policy would eventually
    trust. Fixed by fetching the row first and refusing with
    `BadRequestException` unless `type === WEBSITE`, before any write.
    Regression: `partner-integrations.int-spec.ts` › "refuses to activate
    a %s integration through website verification" (API/POS/EV_CHARGING/
    OCPI, `it.each`), verified via `git stash` to reproduce the exact
    pre-fix outcome (the row ends up `ACTIVE` with `websiteVerifiedAt`
    set) and pass after the fix.

## N. Legal/accounting items

1. ~~Whether an expired `DeferredBonusLot`'s released value is recognized as
   TuTak revenue at expiry (spec §16)~~ — **RESOLVED 2026-08-16** (Arman's
   decision, follow-up to GitHub Issue #28): yes, recognized as revenue.
   `expireOverdueLots`/`expireOne` in `deferred-bonus-lot.service.ts` now
   post a `LedgerService` transaction — DEBIT `BONUS_LIABILITY` / CREDIT
   `PLATFORM_REVENUE`, the lot's `amount` — atomically with the
   `DEFERRED → EXPIRED` claim, for every lot found. The debit releases the
   liability `postContributionLedger` already booked for this lot's
   deferred share back at purchase confirmation (spec §14's deferred share
   is part of that posting's `customerLiability` leg unconditionally,
   whether or not the lot ever unlocks — see the class docblock), so a lot
   can never end up `EXPIRED` without the matching revenue recognized, or
   vice versa. Regression test: `test/purchase-intents.int-spec.ts` ›
   "recognizes an expired lot's value as TuTak revenue, releasing the
   liability booked for it at purchase time" — git-stash-confirmed to fail
   against the pre-fix code (`BONUS_LIABILITY` never released, showing
   `-250.0000` instead of `-100.0000`) and pass against the fix.

## O. Files changed during this hardening pass

Commit `92940af`, 8 files, 471 insertions / 89 deletions:

- `apps/api/src/modules/purchase-intents/purchase-intents.service.ts` —
  the transaction-boundary fix (Finding 1).
- `apps/api/src/modules/payments/payment-engine.service.ts` — self-dealing
  guard added to `capture()`.
- `apps/api/src/modules/payments/payments.module.ts` — stale docstring
  correction.
- `apps/api/src/modules/partners/partners.controller.ts` — the
  ownership-scope fix on `updateCommercialSettings`.
- `apps/api/src/modules/partners/partner-integrations.service.ts` +
  `.controller.ts` — audit trail added.
- `apps/api/src/modules/referral/referral.service.ts` — audit trail
  added; explicit `TODO: BUSINESS DECISION REQUIRED` marker added at the
  Challenge reward's point of use.
- `apps/api/test/purchase-intents.int-spec.ts` — 6 new regression tests
  (financial transaction boundary ×2, concurrency/idempotency ×3,
  cross-partner ownership escalation ×1).

No file outside `apps/api` was touched. No migration file was added or
changed. No unrelated file, debug artifact, or secret is present in the
diff (checked via `git diff --stat` and a pattern scan for private-key/API-
key/`console.log`/`debugger` markers — none found).

## P. Final git status

```
$ git status --short --branch
## claude/tutak-loyalty-mvp-e485jm...origin/claude/tutak-loyalty-mvp-e485jm
```

Clean working tree, HEAD `92940af` pushed and in sync with the remote as of
this report.

## Q. Independent auditor handoff — where to look first

Highest-risk code, in priority order:

1. **`apps/api/src/modules/purchase-intents/purchase-intents.service.ts`**
   — the canonical purchase flow. Read `settlePurchase()` first (the
   transaction-boundary fix); then `postContributionLedger`/
   `postRedemptionCompensation` for the pool split and sign convention;
   then `create()` for the self-dealing/commercial-snapshot logic.
2. **`apps/api/test/purchase-intents.int-spec.ts`** — the test file that
   proves §C's invariants. The "financial transaction boundary" and
   "concurrency and idempotency" blocks are the ones worth re-deriving by
   hand rather than trusting.
3. **`apps/api/src/modules/wallet/bonus-engine.service.ts`** — the shared
   reserve/settle/release/accrue primitive every purchase path (including
   the pre-existing QR and EV paths) is built on.
4. **`apps/api/src/modules/ledger/ledger.service.ts`** — the double-entry
   core: `post()`'s balance check, `accountFor`'s find-or-create, and the
   DB-level trigger backing `ledger_postings`' immutability
   (`prisma/migrations/20260807000000_double_entry_ledger/migration.sql`).
5. **`apps/api/src/modules/wallet/deferred-bonus-lot.service.ts`** — the
   30% "black" pool engine, small and self-contained, worth reading in
   full (135 lines).
6. **`apps/api/src/modules/referral/referral.service.ts`** — both referral
   mechanics (recurring share + Challenge); the funding-source `TODO` is
   the one deliberately-incomplete piece of accounting in this codebase —
   confirm it stays that way rather than acquiring a guessed ledger
   posting.
7. **`apps/api/src/modules/partners/partners.controller.ts`** +
   `partners.service.ts` — the onboarding state machine and the
   OWNER-scope fix; `assertPartnerScope`/`isAffiliated` are the two
   authorization primitives worth understanding before trusting any other
   partner-scoped endpoint.
8. **`apps/api/src/modules/payments/payment-engine.service.ts`** — the
   older, separate Financial Core capture path, now carrying the same
   self-dealing guard as the flows above; worth comparing against
   `qr-payments.service.ts`'s `redeem()` to see the pattern in its
   original, most-explained form.
9. **`apps/api/prisma/migrations/20260816000000_core_business_architecture/migration.sql`**
   — the schema diff this whole feature rides on.
10. **`docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md`** and
    **`docs/CORE_ARCHITECTURE_COMPLETION_REPORT_2026-08.md`** — read these
    two before forming an opinion on anything marked "intentional" above;
    most "why not X" questions are already answered there with the
    reasoning, not just the conclusion.

**Do not assume FastCharge/EV charging needs auditing for this feature** —
§H's zero-line diff is the actual evidence, re-verified independently this
pass; the one open EV finding (§H, §M-7) is a pre-existing gap unrelated to
this feature, not something the core-business-architecture work introduced
or worsened.
