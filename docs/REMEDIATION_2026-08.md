# Remediation of the re-audit — August 2026

Closes every Critical and every High in `docs/AUDIT_2026-08-B.md` except H11,
which is a missing subsystem rather than a defect. Each fix was verified the
same way: reproduce the exploit in a test, apply the fix, confirm the test now
passes, then remove the fix again and confirm the test fails.

Test count: **221 passing** (55 unit, 166 integration), up from 141.

---

## Critical

### C1 — unlimited bonus minting through EV charging — **FIXED**

`POST /ev/sessions/:id/meter-value` took the billed energy from the client with
no ownership check and no plausibility check, so `start → meter-value
{ energyKwh: "9999999" } → stop` minted roughly fifty million points per
session, repeatably.

Two guards now stand between a client and the bill. The caller must own the
session or hold `EV_STATION_MANAGE` scoped to the station's partner — a
non-owner gets a 404, so a session id is no longer authority over someone
else's bill. And the reading must be deliverable: `powerKw × elapsedHours ×
1.15`, with a 1 kWh floor. A 50 kW connector running for an hour tops out near
57 kWh, so the accrual is bounded by physics rather than by the client's claim.

The bound is re-checked at settlement, because `reportMeterValue` is not the
only path that can write an energy reading and `stop()` is the moment the
number becomes money. A rejected settlement frees the connector rather than
stranding the bay.

*Not fully closed:* meter values still arrive over the customer API rather than
from an authenticated charge point. The exploit is dead — the ceiling is now
physical — but genuine OCPP/OCPI ingestion is the real answer and is not built.

### C2 — committed super-admin password — **FIXED**

The seed refuses to run without `SEED_ADMIN_PASSWORD` (12 characters minimum)
and creates the account with `mustChangePassword` set. A new global
`PasswordRotationGuard` enforces that flag: with a rotation pending the account
can reach change-password and logout and nothing else. A bootstrap credential
can therefore log in once and replace itself, and can never be used to operate
the platform.

### C3 — no password recovery — **FIXED**

Added `POST /auth/change-password`, `POST /auth/password-reset/request` and
`POST /auth/password-reset/confirm`. Reset codes are stored as SHA-256 hashes,
expire in 10 minutes, allow five attempts before the challenge burns, and are
superseded when a new one is requested. The request endpoint always reports
success, because saying otherwise makes it an enumeration oracle. Every path
that establishes a new password revokes all refresh tokens and clears the
lockout counters.

`generateNumericCode` was dead code with a modulo bias; now that it is
load-bearing it uses rejection sampling.

*Not fully closed:* the code is persisted as an SMS-channel notification, the
same shape every other outbound message uses. No carrier integration exists, so
in production the code is written to the database and never delivered.

### C4 — farmable referral reward — **FIXED**

`redeem()` refuses a code the caller issued: a payment needs two parties, and a
self-redemption manufactured a `COMPLETED` transaction out of nothing.
Qualification now additionally requires a real partner behind the transaction,
an amount at or above a floor, and a referrer who is not the referee.

*Not fully closed:* registration is still unverified — `isPhoneVerified` is
never set and never checked. The farm is closed because the fabricated
transaction is, not because the fabricated accounts are.

### C5 — double / repeated referral reward — **FIXED**

The invite is claimed with a conditional `updateMany` on `status: PENDING`
inside the same transaction as the accrual. Exactly one concurrent caller wins,
and a failed accrual rolls the claim back so the referral stays payable rather
than vanishing.

### C6 — ADMIN self-escalation to SUPER_ADMIN — **FIXED**

Three rules govern a grant: nobody may change their own roles, nobody may grant
or revoke a role ranked above their own, and a role's scoping must match its
kind. Revoking the last `SUPER_ADMIN` is refused — it locks every operator out
with no way back in through the product.

---

## High

| | Finding | Status |
| --- | --- | --- |
| **H1** | Refresh rotation not atomic, no reuse detection | **FIXED** — conditional `updateMany`; replaying a rotated token revokes the whole device family and raises a HIGH fraud signal; `replacedByTokenId` is now written |
| **H2** | Web apps store both tokens in `localStorage` | **FIXED** — refresh token moved to an httpOnly, `SameSite=Strict` cookie scoped to `/v1/auth`; only the access token stays in the store; native clients unchanged |
| **H3** | `partner.isActive` written, never read | **FIXED** — redemption, accrual and session start all refuse an inactive partner |
| **H4** | Internal error messages returned to clients | **FIXED** — only messages the application wrote are returned; everything else gets a generic body plus a correlation id, with detail in the log |
| **H5** | Partner scope never enforced on EV assets | **FIXED** — `common/auth/partner-scope.ts`, applied to station and connector creation |
| **H6** | Mobile defeats idempotency, mis-sends bonus | **FIXED** — key minted once per payment attempt and held across retries; the decimal string is sent unchanged; server errors surfaced |
| **H7** | Fraud signals raised and ignored | **FIXED** — exceeding the velocity limit flags and refuses the transaction; the EV path has a check for the first time; a held QR payment leaves the code `ACTIVE` |
| **H8** | Platform analytics readable by any partner | **FIXED** — admin-only |
| **H9** | Analytics loads all rows, sums with floats | **FIXED** — `aggregate` + `groupBy`, totals stay `Decimal` |
| **H10** | Lockout DoS and login enumeration | **FIXED** — counter cleared when the lock applies; one indistinguishable error for unknown, locked, wrong-password and deactivated; comparable timing on an unknown number |
| **H11** | No settlement, payout or refund path | **OPEN** — see below |
| **H12** | Redis client has no error handler | **FIXED** |

Fixed in passing while in the same files: **M2** (seeded admin had no referral
code, 500ing `/referral/me/code`), **M3** (`@Body('isActive')` bypassed
validation on two security toggles), **M5** (CORS reflected any origin with
credentials when `CORS_ORIGINS` was unset — production now refuses to boot),
**M6** (no `trust proxy`), **M10** (`refresh()` ignored lockout and soft
deletion), **M18** (unvalidated analytics date range), **M19** (`AuthGate`
bounced signed-in operators on reload), **L3** (modulo-biased OTP), **L10**
(mobile swallowed the server's error).

---

## Remaining blockers

**1. H11 — no payment, settlement, payout or refund subsystem.** Transactions
are recorded, never collected. There is no PSP integration, no partner ledger,
no payout run, and `TransactionType.REFUND` is never produced, so a refunded
purchase leaves its accrued bonus permanently granted. This is the largest
missing piece and is a design task, not a fix.

**2. Registration is unverified.** `isPhoneVerified` is never set and never
checked. Fake accounts are still free; C4 closed what they could be used for,
not the ability to create them.

**3. Password reset codes are never delivered.** The row is written; no SMS
provider is wired.

**4. Meter values still come from the customer API.** Bounded by physics now,
but a charge point does not authenticate in its own right.

**5. Compensation and referral qualification are still best-effort.** The
`transaction.completed` listener is fire-and-forget: a process death between
`markCompleted` and the listener loses the referral silently. Saga rollback has
the same shape. Both need a durable outbox.

**6. `bonus_ledger_delta_matches_direction` remains `NOT VALID`** on databases
with pre-existing rows (carried over from the previous pass).

**7. Concurrency is covered by targeted tests, not load.** Four races are
tested — reservations, referral claim, token rotation, lot allocation — but
nothing has been run under real contention.

---

## Scores

| Dimension | Before | After | Why |
| --- | ---: | ---: | --- |
| **Production readiness** | 22 | **48** | The three launch-blocking defects are gone: no minting path, no committed credential, and account recovery exists. Still short of launch on payments, SMS delivery and phone verification — all missing subsystems rather than bugs. |
| **Security** | 31 | **74** | Privilege escalation, the unauthenticated billing input, unscoped partner authorization, `localStorage` tokens, error disclosure, token-reuse blindness and the lockout DoS are all closed and regression-tested. Held back from higher by unverified registration and the absence of a second factor anywhere. |
| **Architecture** | 64 | **68** | Authorization moved from hand-rolled per-controller checks into a shared, tested module, and the password lifecycle has one write path. The structural gaps are unchanged: no payment layer, no outbox, in-process cron that will double-fire on a second replica. |
| **Code quality** | 71 | **79** | 221 tests, every fix mutation-verified, ESLint clean, no new dead code. The duplicated `httpClient`/`authStore` between admin and partner remains. |

---

## Round two — re-audit of the fixed code

The fixed code was audited again from scratch rather than trusted. Three
further issues were found and fixed; one blocker was found that cannot be
fixed within "no new features".

**Found and fixed**

- **Self-dealing through merchant codes (Critical).** Blocking self-redemption
  only ever covered `USER_PAY_TOKEN`, the one type whose issuer was recorded.
  A partner member could raise a `DYNAMIC_INVOICE` against their own partner
  for any amount and pay it themselves — measured at 50,000 points per call.
  The issuer is now recorded on every code, and membership (not just identity)
  bars redemption, so two staff cannot issue for each other.
- **Unbounded session duration (High).** The meter bound is proportional to
  elapsed time and nothing closed an abandoned session: 30 days open billed
  36,000 kWh and 180,000 points, and the bay stayed `CHARGING` forever. The
  billable window is capped at 24 hours and an hourly sweep frees the bay.
- **Reset-code guessing (High).** Five attempts per challenge bought five more
  with each new code. Ceilings now follow the account: five codes and fifteen
  wrong guesses per hour.

**Verification.** All 232 tests pass. Disabling six of the guards added across
both rounds — the negative-amount check, the meter bound, the role-rank check,
partner deactivation, account-state enforcement and error redaction —
produces 24 failures across 11 suites, so the regression net covers them.

**Still open — see the Critical entry below.**

### Remaining Critical: bonus is minted by asserting a payment that never happens

`STATIC_MERCHANT` codes are reusable by design, carry a fixed amount, and are
displayed publicly — that is what a shop-window QR is. Any authenticated user
who can photograph one can redeem it repeatedly and accrue bonus on an amount
nobody collected. Measured: five scans of a 100,000 AMD code at 5% produced
25,000 points, with no money paid and no collusion. The velocity limit throttles
this to eight redemptions per ten minutes per account; registration is
unverified, so accounts are free and the aggregate is unbounded.

This is the concrete form of the missing payment layer. It cannot be fixed by
hardening: the redemption is indistinguishable from a real one because nothing
in the system ever confirms that money moved. There are two honest options,
both product decisions rather than defects to patch:

1. Build payment authorization and settlement, so a redemption requires a
   confirmed charge.
2. Until then, disable the exploitable configuration — refuse to redeem
   `STATIC_MERCHANT` codes, leaving merchant-initiated `DYNAMIC_INVOICE`
   codes, which are bounded by an act of the merchant per payment.

Option 2 is a one-line refusal in `QrPaymentsService.redeem`. It has not been
applied, because removing a shipped payment path is a decision for the product
owner, not a fix to be made silently during an audit.
