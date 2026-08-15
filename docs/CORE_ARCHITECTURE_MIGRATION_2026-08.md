# Core business architecture migration — 2026-08-15/16

Owner sent a full overnight spec ("TUTAK — CORE BUSINESS ARCHITECTURE
IMPLEMENTATION TASK") that supersedes `docs/REFERRAL_COMMISSION_MODEL_RU.md`
and parts of `docs/PARTNER_TERMS.md` where they conflict, per the spec's own
rule ("Where this specification conflicts with old TuTak rules, THIS
SPECIFICATION is the current source of truth"). This document is the
required step 4 of the spec's own process ("prepare an internal
migration/refactoring plan") before touching money code, and doubles as the
running legacy-conflict classification (spec §29) and the architectural
decisions made along the way, so a session that picks this up later does not
have to re-derive them.

Five research passes (read-only) mapped the actual code before anything below
was written. Findings first, decisions after.

---

## 1. What the inspection found (built vs. only documented)

**Partner domain.** `Partner` is a flat entity + `PartnerBranch[]` (address
only — no per-branch config/staff) + `PartnerMembership` (bare join, no
role). Status is a single `isActive: Boolean`, no state machine. No approval
flow exists — `POST /partners` is admin-only and activates immediately.
Staff RBAC is two flat roles, `PARTNER_OWNER`/`PARTNER_STAFF`, no
OWNER/MANAGER/CASHIER tiers. No integration-type concept anywhere; EV
capability is just `EvStation.partnerId`, a plain FK. No bonus-payment cap
field exists — `PARTNER_TERMS.md`'s planned cap was never built.

**QR purchase flow.** Fully synchronous today — `POST /qr/redeem` reserves
the bonus and settles it in the same call, no confirm step, no 4-digit code,
no push-to-partner. `docs/PARTNER_TERMS.md`'s "customer enters amount, staff
confirms within a minute" design is **only a decision on paper**, not code.
Bonus accrual uses the **paid-portion (net)**, not gross — direct conflict
with spec §9. `BonusEngineService.reserve/settleReservation/releaseReservation`
already exist, are transactional (Prisma `$transaction`, conditional
`updateMany` guards), and are exactly the primitive spec §7's
AVAILABLE→RESERVED→SPENT/AVAILABLE state machine needs — reused, not rebuilt.

**Referral engine.** The 3-level 1%/0.5%/0.5% cascade from
`REFERRAL_COMMISSION_MODEL_RU.md` **does not exist in code** — only a flat,
one-time, single-referrer 1000 AMD reward on the referee's first ≥1000 AMD
purchase. No green/black split on `BonusLot` at all — `BonusLotStatus` is
purely `PENDING/AVAILABLE/EXPIRED/CONSUMED`, a time-based cooling-off window,
nothing turnover-gated. The "first 3 friends" 1000+1000 bonus (spec §18) is
**not built either** — the existing flat reward is actually the closer
ancestor of that mechanic, not of the new recurring 20%-pool referral share
(spec §6), which is new in both directions.

**Settlement ledger.** A real, tested, DB-invariant-enforced double-entry
ledger already exists (`LedgerAccount`/`LedgerTransaction`/`LedgerPosting`,
immutable postings, balancing trigger, `replayBalance()` reconstructs from
postings alone — this is spec §22's "auditable ledger", already built, not a
gap). `LedgerTransaction.kind` is a free string already, so new entry-type
vocabulary needs no schema change. **The QR flow does not post to this
ledger by default** — only through `QrLedgerMirrorService`, feature-flagged
off (`FEATURE_QR_LEDGER_MIRROR`), and when on it posts **one netted CREDIT**
to `PARTNER_PAYABLE`, not the two separate entries spec §23 requires.
`docs/FINANCIAL_CORE_DESIGN.md` documents this explicitly as "the phase-4
cut-over — not yet taken" and marks it the highest-risk step in the whole
financial core.

**Sign convention.** Internally, `LedgerService.signed()` computes
`balance = Σdebits − Σcredits` uniformly, so a `PARTNER_PAYABLE` balance
(CREDIT-normal) is stored as a *negative* number as the platform owes the
partner more. `payout-engine.service.ts`'s `availableBalance()` already
negates this before returning it externally — so the **external, business-facing
read already returns positive-when-owed-to-partner**, matching spec §23
exactly. The "opposite convention" is only in the raw internal storage.
Flipping the raw storage would touch payout, reconciliation, refund and every
existing ledger test for a change that has no external effect — the classic
"cleaner architecture that isn't worth the blast radius" spec §31 warns
against. **Decision: do not touch the internal sign convention. Any new
partner-settlement read this migration adds presents positive-when-owed, via
the same negation pattern already used, not by changing storage.**

**EV-charging / OCPI.** A real OCPI 2.2.1 client and CDR-reconciliation loop
exist, but are dead code in practice — no live roaming partner, `Noop`
adapter active by default. EV charging computes bonus accrual with the
**same formula as QR** (paid-portion × `bonusAccrualRateBps`) but as an
**independently re-implemented copy**, not a shared function — a pre-existing
duplication this migration does not need to fix tonight, only avoid making
worse. Meter-value physical-bounds guard (`assertDeliverable`) and the stop
idempotency key are both real and unrelated to anything this migration
touches.

---

## 2. Legacy conflict classification (spec §29)

| Rule | Classification | Note |
|---|---|---|
| 2% immediate / 3% frozen split | **SUPERSEDED** | Never implemented — nothing to migrate, only to not build |
| 3-level referral (1%/0.5%/0.5%) | **SUPERSEDED** | Never implemented |
| 6-month / 15,000-AMD-per-month deferred unlock | **SUPERSEDED** | Never implemented |
| Universal 30% bonus-payment cap | **SUPERSEDED** | Never existed in code; today's real cap is "none" (100%), which is what spec §11 also lands on |
| Flat one-time 1000 AMD referral reward (`referral.service.ts`) | **MIGRATE** | Becomes the base for the Referral Challenge (§18-20), not for the new recurring share (§6), which is unrelated and new |
| `ReferralInvite` model, immutable-by-unique-constraint | **KEEP** | Already matches spec §5's immutability requirement as a side effect of the schema; made explicit rather than incidental |
| `bonusAccrualRateBps` on `Partner` | **KEEP, REPURPOSED** | Becomes spec §10's "negotiated partner rate" feeding the contribution pool, instead of being paid to the customer directly at 100% |
| QR paid-portion accrual base | **MIGRATE** | New `PurchaseIntent` flow uses gross (§9); legacy `POST /qr/redeem` is left running unchanged for backward compatibility, see §3 below |
| `BonusEngineService` reserve/settle/release | **KEEP** | Reused as-is for green-bonus reservation in `PurchaseIntent` |
| Double-entry ledger core (`LedgerService`, accounts, invariants) | **KEEP** | Reused; only new `kind` vocabulary and posting shapes added |
| Ledger sign convention (internal storage) | **KEEP** | See §1 above — external read already correct |
| `QrLedgerMirrorService`'s single netted posting | **NOT TOUCHED** | Belongs to the *old* QR path, which this migration deliberately leaves running; the new `PurchaseIntent` flow gets its own, correctly-split postings |
| Partner-funding-lock vs activity-lock bonus concepts (spec §17) | **N/A** | Neither concept exists in code today, so there is nothing to conflate or separate — §17's warning is satisfied by construction |
| Platform-wide 60-70% payment-cap ceiling (`PARTNER_TERMS.md`) | **SUPERSEDED** | Spec §11 explicitly wants no universal cap and says not to invent a new restriction; the old proposed ceiling is dropped |
| EV charging bonus formula | **KEEP, UNTOUCHED** | Spec §4 explicitly forbids redesigning the charging-session payment flow tonight; kept on paid-portion + flat rate, not migrated to the new pool split |

---

## 3. Key architectural decisions (engineering authority, not business invention)

**PurchaseIntent is additive, not a replacement of `POST /qr/redeem`.**
Building the full staff-confirm mobile UI is explicitly out of scope tonight
("DO NOT redesign screens"), and the existing endpoint has real tests and
(per the repo's own demo/investor-walkthrough materials) live usage. Ripping
it out to force everything through the new flow in one night is exactly the
"disruptive migration" spec §26/§31 asks to flag rather than do silently.
`POST /qr/redeem` keeps working exactly as before. The new
`PurchaseIntent` endpoints are the new core the spec asks for; wiring the
existing mobile customer screen to them, and building the partner-side
confirm screen, is next-session UI work, not tonight's.

**"Partner Settlement Ledger" (spec §22) = the existing double-entry ledger,
extended.** Spec §22 describes a ledger with account-like entry types
(`PARTNER_CONTRIBUTION`, `BONUS_REDEMPTION_COMPENSATION`,
`PARTNER_REFERRAL_CREDIT`, `ADJUSTMENT`, `SETTLEMENT/PAYOUT`). Building a
second, parallel ledger to hold these would directly violate the spec's own
repeated instruction to reuse rather than duplicate. These become `kind`
string values on `LedgerTransaction` (already a free string, no schema
change), posted against the *existing* `LedgerAccountType`s
(`PARTNER_PAYABLE`, `BONUS_LIABILITY`, `PLATFORM_REVENUE`) — entry type
describes the business event, account type describes the GL bucket; that is
correct double-entry modeling, not a shortcut.

**Deferred bonus does not reuse `BonusLot`'s PENDING→AVAILABLE sweep.** That
sweep promotes on elapsed *time* unconditionally (a cooling-off window). A
deferred lot's promotion condition is cumulative *turnover*, not time —
reusing the same status field would either wrongly auto-promote it early or
require bolting a turnover check onto a sweep that every other accrual type
also uses. `DeferredBonusLot` is instead a wholly separate model (as spec
§13 itself describes) that does **not** touch `Wallet`/`BonusLot` at all
until it actually unlocks, at which point it calls `BonusEngineService.accrue()`
once, for real, immediately available. The customer's balance never shows
the deferred amount as spendable before qualification — matching the
explicit rule spec §19 states for the Referral Challenge, applied here by
the same logic.

**Referral Challenge, similarly, is not a spendable balance until
qualification.** New `ReferralChallenge`/`ReferralChallengeParticipant`
tracking, evolved from the existing flat-1000-AMD one-shot reward code
(closest ancestor, see classification table) rather than built from zero.

**FastCharge / EV charging is not touched.** Its bonus formula, its
partner-rate lookup, its OCPI adapter selection, its idempotency key — none
of it changes. The spec's own §4 explicitly prioritizes "do not break
working charging economics" over "uniform gross-amount rule" when the two
are in tension, and they are: making EV honor the new gross+pool-split rule
tonight would mean redesigning the charging-session payment flow, which §4
and §36 both explicitly forbid. Recorded here as intentional scope
exclusion, not an oversight.

---

## 4. Unresolved business decisions (collected; also left inline as
`TODO: BUSINESS DECISION REQUIRED` at point of use)

1. Domain/website-verification method for `PartnerIntegration` (spec §3) —
   no technical method specified.
2. Referral Challenge funding source (spec §20) — architecture built,
   nothing auto-charges a partner or the 20/30/20/30 pool.
3. Staff amount editing on `PurchaseIntent` confirm (spec §26) — today's QR
   flow has no staff amount-editing at all (customer enters the amount,
   partner cannot rewrite it), so this is not a conflict to resolve, but
   recorded per the spec's instruction to state it explicitly rather than
   assume.
4. What happens to a partner's positive settlement balance on offboarding —
   already an open item in `PARTNER_TERMS.md`, unchanged by this migration.

## 5. Unresolved legal/accounting items

1. Whether an expired `DeferredBonusLot`'s released value is recognized as
   TuTak revenue at expiry — spec §16 explicitly defers this
   (`TODO: LEGAL / ACCOUNTING REVIEW REQUIRED`); implemented here only as a
   ledger/product state transition (`DEFERRED → EXPIRED`), no revenue
   posting is made automatically.

---

*Implementation log continues in commit messages on
`claude/tutak-loyalty-mvp-e485jm`; final status goes in the completion
report (spec §38) at the end of this session.*
