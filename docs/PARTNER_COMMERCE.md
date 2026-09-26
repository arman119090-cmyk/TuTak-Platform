# Partner Commerce — architecture record (v2, 2026-09-26)

Offline QR purchases and online orders from partner websites, on the one
financial core TuTak already has. This is the engineering record; the
authoritative status, test counts and open items are in the final Russian
report for the task. Decisions reference Arman's answers to the pre-flight
(Q1–Q7, D7, D8, E1–E5) and the open questions (Q8–Q12).

## 1. What was reused, not rebuilt

| Need | Existing primitive | How |
|---|---|---|
| Money movement | `LedgerService` (double entry, immutable postings, `replayBalance`) | Every movement is one `post()` through `CommerceLedgerService`. No second ledger. |
| Real reserve (Q2) | `PARTNER_ORDER_ESCROW` ledger account | Electronic legs are captured into it; released or returned by their own postings. |
| Discount balance (green) | `BonusEngineService` reserve → settle / `reverseSettlement` / `restoreSpentBonus` | Spent exactly like a QR purchase; its platform-side value moves `BONUS_LIABILITY` → escrow. |
| Customer money | `CUSTOMER_PREPAID_BALANCE` + `BankTopUpAdapter` | Second named spender (Q1 = C); claim-then-post like `collectFromBalance`. IDRAM adapter itself is not connected yet. |
| 20/30/30/20 distribution | `settlePurchase` logic | Extracted unchanged into `CommissionDistributionService`; QR and online both call it (E1). |
| Referral | `ReferralService.resolveReferralChain/computePoolSplit/creditChainShares` | Used as is. |
| Website credential | `PartnerIntegration(WEBSITE)` + `PartnerApiKey` (`x-api-key`) | From v1. |
| Timers | BullMQ repeatable sweeps (`sweeps.jobs.ts`) | New sweeps only; no process-local timers. |
| Operator alerts | `AlertsService.fire` (webhook, Redis suppression) | Per-tick keys for the 5-minute repeats. |
| Customer/partner notifications | `NotificationsService` (inbox + push, i18n keys) | `PartnerOrderNotifier`. |
| Settlement money | `PayoutEngineService`, `PartnerCollectionService` | Unchanged; statements only document. |
| RBAC / scope | `assertPartnerScope`, `branchFilterFor`, `assertPlatformAdmin` | New permissions `PARTNER_ORDER_OPERATE`, `ORDER_DISPUTE_RESOLVE`. |

## 2. Payment model (Q1 = C)

One purchase = up to three independent sources; they are never mixed in the
ledger:

- **DISCOUNT** — green discount balance (not money), capped by the partner's
  `maxBonusPaymentPercent`.
- **TUTAK_MONEY** — real money in `CUSTOMER_PREPAID_BALANCE`.
- **EXTERNAL** — paid to the partner directly (cash, own card, on delivery);
  never touches TuTak's ledger; confirmed by an employee on shift.

`discount + tutakMoney + external = total` (DB CHECK once submitted). The
commission (pool) is always computed on the full total.

## 3. Online order state (four dimensions)

```
operationalStatus
  DRAFT ─submit→ SUBMITTED ─seen→ SEEN ─in stock→ STOCK_CONFIRMED ─handed over→ HANDED_OVER
    ─customer "Получил заказ"→ RECEIVED ─(all external legs confirmed, no open dispute)→ COMPLETED
  SUBMITTED|SEEN ─out of stock→ OUT_OF_STOCK ─(sourcing proposal accepted | partner found it)→ STOCK_CONFIRMED
  DRAFT ─24h→ EXPIRED
  DRAFT|SUBMITTED|SEEN|STOCK_CONFIRMED|OUT_OF_STOCK ─cancel→ CANCELLED
  ("Получил заказ" is accepted from STOCK_CONFIRMED or HANDED_OVER; after
   handover a cancel is refused — it is a return.)

paymentStatus
  UNFUNDED ─submit→ RESERVED (electronic legs in escrow) ─external confirmed→ FUNDED
  ─completion→ SETTLED ─return→ PARTIALLY_REFUNDED | REFUNDED
  cancel → REFUNDED, or REFUND_PENDING while a confirmed cash leg waits for the partner

sourcingStatus  NONE → REQUIRED → SEARCHING → AWAITING_CUSTOMER → RESOLVED | FAILED
disputeStatus   NONE → OPEN → RESOLVED_CUSTOMER | RESOLVED_PARTNER | RESOLVED_SPLIT

payment leg     DISCOUNT/TUTAK_MONEY: PENDING → CAPTURED → SETTLED | RETURNED
                EXTERNAL: PENDING → CONFIRMED → CORRECTED (before handover only) | RETURN_PENDING → RETURNED
```

Every transition is a conditional `updateMany` on the *from* state inside
the same transaction as its money movement: a race has exactly one winner.

### The "Получил заказ" rule (Q3)

The goods are handed over first; the customer then confirms receipt (with a
second "Вы подтверждаете…?" dialog). There is no rule anywhere that forbids
handing over before the tap — none existed in code or docs. 24 h after
handover the customer is reminded; at 48 h the order goes to manual review.
The escrow is **never** released by a timer — only by the customer's
confirmation or an audited admin decision.

## 4. Ledger flows

| Flow | Postings |
|---|---|
| F1 discount capture | bonus reservation settled; DEBIT `BONUS_LIABILITY` / CREDIT `PARTNER_ORDER_ESCROW` |
| F2 money capture | DEBIT `CUSTOMER_PREPAID_BALANCE` / CREDIT `PARTNER_ORDER_ESCROW` (claimed on the account row) |
| F3 completion | DEBIT escrow / CREDIT `PARTNER_PAYABLE` (all electronic legs) + the existing `partner.contribution` posting (PARTNER_PAYABLE → BONUS_LIABILITY / partner referrers / PLATFORM_REVENUE) + green, black and referral lots |
| F4 cancel | each captured leg back to its source (`reverseSettlement` for the discount); confirmed cash → RETURN_PENDING |
| F5 QR money | at creation money → escrow; confirm escrow → PARTNER_PAYABLE; reject/expire escrow → money |
| F6 return (r = amount/total) | `partner.contribution_refund` for r × snapshot; PARTNER_PAYABLE → CUSTOMER_PREPAID_BALANCE (money share); PARTNER_PAYABLE → BONUS_LIABILITY + `restoreSpentBonus` (discount share); external share → partner refunds and confirms |
| F7 dispute | PARTNER_PAYABLE ↔ `PARTNER_DISPUTE_HOLD`; outcome as a return |

Netting (spec §11) happens in `PARTNER_PAYABLE`: electronic receivable
credited, the pool debited. Cash the partner received is never credited.

**Shortfall on a return (Q7a, Q8/Q9 open).** If part of the distribution
was already spent, the return is rolled back entirely and recorded as
`MANUAL_REVIEW` — nothing moves, TuTak absorbs nothing, no negative
balance. The existing QR refund keeps its old behaviour until Q9 is
answered.

## 5. Commission and prepayment (Q5, E4)

`Partner.bonusAccrualRateBps` is the one base rate. `CommissionRule` is
override-only (`serviceType` and/or `category`), one active per scope,
same 0.5–20 % grid. Resolution: serviceType+category → serviceType →
category → base. The rate is frozen on the order at creation; one rate per
order. Euro Import's vehicle orders send only the service fee as items.
`PrepaymentRule` (percent/fixed, partner-wide or scoped) — the electronic
legs must cover it at submit; shown before confirmation.

## 6. Shifts (Q4)

`EmployeeShift` per branch, business day by the branch's own timezone and
start minute (default 05:00 Asia/Yerevan). Several employees per branch; one
open shift per employee; starting a shift closes the branch's shifts from a
previous business day only; an hourly sweep closes the rest; deactivating a
branch assignment closes the shift in the same transaction. Every cash-desk
action (QR confirm/reject/refund, external payment confirm/correct, cash
return confirmations, returns) locks the shift row in its own transaction.

Rollout: existing partners get `shiftsRequiredFrom = migration + 14 days`,
during which a shiftless action works but is audited `withoutShift`; new
partners require shifts immediately. The date can only be moved earlier.
Partners with no branch must create one (e.g. "Online / office") — the
cabinet prompts for it.

## 7. SLA (Q7d, E3)

From `submittedAt`: 5 min not seen → alert (once); 30 min no stock decision
→ critical, repeated every 5 min until an operator claims it ("Взял в
работу"); the order stays in the queue until resolved. Abandoned DRAFTs
never alert and expire after 24 h.

## 8. Disputes and settlement (spec §49-52, Q7b)

A dispute opened before the order's credit reached a settlement statement
freezes that credit into `PARTNER_DISPUTE_HOLD` (payouts cannot reach it).
After settlement nothing is frozen; a customer-favourable decision runs as a
return and `PARTNER_PAYABLE` may go positive — the partner's debt, carried
by the next statement. One OPEN dispute per order; resolution is a claim on
OPEN (two admins → one decision).

Statements: per-partner `settlementPeriod` (existing partners BIWEEKLY);
each statement's lines are the partner's PARTNER_PAYABLE and HOLD postings
not yet on any statement; `closing = opening + Σ lines`. The 14-day
overdue check now uses each partner's own period.

## 9. Migration

`20260926090000_partner_commerce` replaces the never-applied v1 migration
and is purely additive (no DROP). Checks added for money sanity, AMD-only
orders, the rate grid, one active rule per scope, one open dispute per
order, one open shift per employee. The `purchase_intents` split CHECK is
`NOT VALID` (enforced for new rows without rescanning history). Verified on
an empty database and on a populated one (base-branch code + demo seed):
ledger balances, replay and row counts identical before and after.

New permissions reach existing environments through the baseline seed
(`seedBaseline` upserts every role/permission pair).
