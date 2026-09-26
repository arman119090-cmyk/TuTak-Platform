# Partner Commerce — architecture record (v2 + final fixes, 2026-09-26)

Offline QR purchases and online orders from partner websites, on the one
financial core TuTak already has. This is the engineering record; the
authoritative status, test counts and open items are in the Russian reports
(`PARTNER_COMMERCE_V2_REPORT_2026-09-26.md`, then
`PARTNER_COMMERCE_FINAL_DELTA_REPORT_2026-09-26.md` for everything after
7e44ad8). Decisions reference Arman's answers to the pre-flight (Q1–Q7, D7,
D8, E1–E5) and to Q8–Q13, plus the two final-fixes answers: a withheld
referral share is credited to the selling partner only as it is repaid
("the partner waits"), and a cancellation cost is taken only from real money.

## 1. What was reused, not rebuilt

| Need | Existing primitive | How |
|---|---|---|
| Money movement | `LedgerService` (double entry, immutable postings, `replayBalance`) | Every movement is one `post()` through `CommerceLedgerService`. No second ledger. |
| Real reserve (Q2) | `PARTNER_ORDER_MONEY_ESCROW` + `PARTNER_ORDER_DISCOUNT_ESCROW` ledger accounts | Split by provenance (item 9): money legs only ever in the money escrow, the discount only in the discount escrow; each released or returned by its own postings. |
| Discount balance (green) | `BonusEngineService` reserve → settle / `reverseSettlement` / `restoreSpentBonus` | Spent exactly like a QR purchase; its platform-side value moves `BONUS_LIABILITY` → discount escrow. |
| Customer money | `CUSTOMER_PREPAID_BALANCE` + `BankTopUpAdapter` | Second named spender (Q1 = C); claim-then-post like `collectFromBalance`. IDRAM adapter itself is not connected yet. |
| 20/30/30/20 distribution | `settlePurchase` logic | Extracted unchanged into `CommissionDistributionService`; QR and online both call it (E1). |
| Referral | `ReferralService.resolveReferralChain/computePoolSplit/creditChainShares` | Used as is. |
| Website credential | `PartnerIntegration(WEBSITE)` + `PartnerApiKey` (`x-api-key`) | From v1. |
| Timers | BullMQ repeatable sweeps (`sweeps.jobs.ts`) | New sweeps only; no process-local timers. |
| Operator alerts | `AlertsService.fire` (webhook, Redis suppression) | Per-tick keys for the 5-minute repeats. |
| Customer/partner notifications | `NotificationsService` (inbox + push, i18n keys) | `PartnerOrderNotifier`. |
| Settlement money | `PartnerSettlementService` (main) — PartnerSettlement / PartnerSettlementEntry, maker/checker, unique claim per posting | The one engine that pays partners (§14); statements are reports over it. |
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

## 3. Online order state

```
operationalStatus
  DRAFT ─submit→ SUBMITTED ─seen→ SEEN ─in stock→ STOCK_CONFIRMED
    ─(courier / delivery service)→ OUT_FOR_DELIVERY ─partner marks delivered→ DELIVERED
    ─(pickup)→ READY_FOR_PICKUP ─partner marks handed over→ DELIVERED
    (STOCK_CONFIRMED ─delivered directly→ DELIVERED is allowed too)
    ─customer "Получил заказ"→ RECEIVED ─(all external legs confirmed, no open dispute)→ COMPLETED
  SUBMITTED|SEEN ─out of stock→ OUT_OF_STOCK ─(sourcing proposal accepted | partner found it)→ STOCK_CONFIRMED
  DRAFT ─24h→ EXPIRED
  DRAFT|SUBMITTED|SEEN|OUT_OF_STOCK ─cancel→ CANCELLED (immediate, full)
  STOCK_CONFIRMED|OUT_FOR_DELIVERY|READY_FOR_PICKUP|DELIVERED ─cancel→ CANCELLED
    (immediate and full without disclosed terms; otherwise through the
     actual-cost review, §10)
  ("Получил заказ" is accepted from STOCK_CONFIRMED, OUT_FOR_DELIVERY,
   READY_FOR_PICKUP or DELIVERED; after receipt a cancel is refused — it is
   a return.)

cancellationStatus  NONE → REQUESTED (waiting for the partner) → COST_REVIEW (TuTak decides) → NONE

paymentStatus
  UNFUNDED ─submit→ RESERVED (electronic legs in escrow) ─external confirmed→ FUNDED
  ─completion→ SETTLED ─return→ PARTIALLY_REFUNDED | REFUNDED
  cancel → REFUNDED, or REFUND_PENDING while a confirmed cash leg waits for the partner

sourcingStatus  NONE → REQUIRED → SEARCHING → AWAITING_CUSTOMER → RESOLVED | FAILED
disputeStatus   NONE → OPEN → RESOLVED_CUSTOMER | RESOLVED_PARTNER | RESOLVED_SPLIT

payment leg     DISCOUNT/TUTAK_MONEY: PENDING → CAPTURED → SETTLED | RETURNED
                EXTERNAL: PENDING → CONFIRMED → CORRECTED (before dispatch only) | RETURN_PENDING → RETURNED
                (a leg may also carry `retainedAmount`: the part kept as an approved cancellation cost)
```

Every transition is a conditional `updateMany` on the *from* state inside
the same transaction as its money movement: a race has exactly one winner.

### The "Получил заказ" rule (Q3)

The goods are handed over first; the customer then confirms receipt (with a
second "Вы подтверждаете…?" dialog). There is no rule anywhere that forbids
handing over before the tap — none existed in code or docs.

Item 7: a courier handoff (`OUT_FOR_DELIVERY`) or a pickup notice
(`READY_FOR_PICKUP`) starts **no** customer timer. The 24 h reminder and the
48 h manual review count only from `deliveredAt` — the partner's explicit
"delivered / handed to the customer". The escrow is **never** released by a
timer — only by the customer's confirmation or an audited admin decision.

Q10: `COMPLETED` needs both the receipt and every external leg confirmed.
A receipt while an external leg is still pending saves `customerReceivedAt`,
releases nothing, distributes nothing and flags *Payment issue* at once
(audit + escalation + notification). 24 h later it escalates again
(`PAYMENT_ISSUE_24H`). The moment the partner confirms the leg,
`tryComplete` finishes the order and the flag clears.

## 4. Ledger flows

| Flow | Postings |
|---|---|
| F1 discount capture | bonus reservation settled; DEBIT `BONUS_LIABILITY` / CREDIT `PARTNER_ORDER_DISCOUNT_ESCROW` |
| F2 money capture | DEBIT `CUSTOMER_PREPAID_BALANCE` / CREDIT `PARTNER_ORDER_MONEY_ESCROW` (claimed on the account row) |
| F3 completion | one transaction: DEBIT both escrows / CREDIT `PARTNER_PAYABLE` + the existing `partner.contribution` posting (PARTNER_PAYABLE → BONUS_LIABILITY / partner referrers / PLATFORM_REVENUE) + green, black and referral lots |
| F4 cancel | each captured leg back to its own source from its own escrow (`reverseSettlement` for the discount); confirmed cash → RETURN_PENDING; an approved cost is kept per §10 |
| F5 QR money | at creation money → money escrow; confirm money escrow → PARTNER_PAYABLE; reject/expire money escrow → money |
| F6 return (r = amount/total) | `partner.contribution_refund` for r × snapshot (via `CommerceReversalService`); PARTNER_PAYABLE → CUSTOMER_PREPAID_BALANCE net + `CUSTOMER_SHORTFALL_CLEARING` recovered (money share, one posting); PARTNER_PAYABLE → BONUS_LIABILITY + `restoreSpentBonus` (discount share); external share → partner refunds (net) and confirms |
| F7 dispute | PARTNER_PAYABLE ↔ `PARTNER_DISPUTE_HOLD`; outcome as a return |
| F8 desk settlement | DEBIT PARTNER_PAYABLE / CREDIT `CUSTOMER_SHORTFALL_CLEARING` (`*.shortfall_settled_at_desk`): the shortfall the partner kept from the cash it handed back or collected |
| F9 withholding repaid | DEBIT `BONUS_LIABILITY` / CREDIT the selling partner's PARTNER_PAYABLE (`referral.withholding_recovered`) |
| F10 cancellation cost | money part: DEBIT money escrow / CREDIT PARTNER_PAYABLE (`partner_order.cancellation_cost`); cash part: the partner keeps it (`retainedAmount`), no posting |

Netting (spec §11) happens in `PARTNER_PAYABLE`: electronic receivable
credited, the pool debited. Cash the partner received is never credited.

`CUSTOMER_SHORTFALL_CLEARING` (per customer) nets to zero on every executed
return: it is debited by the reversal for the customer's spent share and
credited by exactly the amount recovered from what they get back.

**Q8 — a referrer's spent share.** What is still available is clawed back
now. For a USER referrer the already-spent part becomes a
`ReferralWithholding` (OPEN), repaid FIFO by that user's next positive
accruals (purchase, referral, promotion and deferred releases — not manual
adjustments and not restored discounts). No negative balance; nothing from
`CUSTOMER_PREPAID_BALANCE`; not shifted to the customer, the partner or
TuTak. The selling partner's commission refund for the withheld part is
credited to its PARTNER_PAYABLE only as it is repaid (F9); until then it is
visible to the partner (settlement page) and to TuTak (admin → Commerce
reviews); never written off automatically. A PARTNER referrer is reversed
from its own payable. An *expired* lot is never charged to anyone: its
liability is written back (`BonusLot.expiredWrittenBackAmount`); an expired or
forfeited deferred lot is reversed from `PLATFORM_REVENUE`.

**Q9 — the customer's spent share.** Applies to online orders
(`COMMERCE_V2` always) and to QR purchases created after
`FINANCIAL_POLICY_V2_EFFECTIVE_AT` (`PurchaseIntent.financialPolicyVersion`;
older purchases keep the LEGACY_V1 rule). The shortfall is netted from what
the customer gets back — first the TuTak money refund (automatic, one
posting shows gross / recovered / net), then the cash/external refund the
partner hands back, and any remainder is collected at the desk. Each row
stores `grossRefund`, `recoveredShortfall`, `netRefund` and the parts. Any
desk involvement → `AWAITING_SHORTFALL_SETTLEMENT` with nothing moved, until
an employee on an active shift confirms the exact amounts (a changed amount
→ 409 `SETTLEMENT_AMOUNT_CHANGED` with the new figures). A refusal (customer
or partner) → `MANUAL_REVIEW`: TuTak may only WITHDRAW (the return is not
executed; nothing ever moved) or REOPEN (back to the desk; the amounts are
recomputed by a dry run that always rolls back). No write-off, no hidden
debt, never a negative balance.

## 5. Commission and prepayment (Q5, E4)

`Partner.bonusAccrualRateBps` is the one base rate. `CommissionRule` is
override-only (`serviceType` and/or `category`), one active per scope,
same 0.5–20 % grid. Resolution: serviceType+category → serviceType →
category → base. The rate is frozen on the order at creation; one rate per
order. Euro Import's vehicle orders send only the service fee as items.
`PrepaymentRule` (percent/fixed, partner-wide or scoped) — shown before
confirmation. Q13: only real money satisfies it — the TuTak-money leg (money
escrow). The discount never counts toward the prepayment
(`PREPAYMENT_REQUIRED`); `prepaymentCoveredAmount` is the snapshot at submit.
The checkout split rule is shared by the app and the web checkout
(`@tutak/shared-types` `computeCheckoutSplit`).

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

Item 10: who may work a shift is decided by permission, not by role name —
the API accepts any of `PURCHASE_INTENT_CONFIRM` / `PARTNER_ORDER_MANAGE`
(`RequireAnyPermission`), and the partner cabinet shows the shift bar from
the same permissions returned at login (so `PARTNER_MANAGER` and any future
role with them get it).

## 7. SLA (Q7d, E3)

From `submittedAt`: 5 min not seen → alert (once); 30 min no stock decision
→ critical, repeated every 5 min until an operator claims it ("Взял в
работу"); the order stays in the queue until resolved. Abandoned DRAFTs
never alert and expire after 24 h.

## 8. Disputes and settlement (spec §49-52, Q7b)

A dispute opened before the order's credit was committed by the settlement
engine (claimed by a settlement APPROVED or later) freezes that credit into
`PARTNER_DISPUTE_HOLD`. After that nothing is frozen; a customer-favourable
decision runs as a return and `PARTNER_PAYABLE` may go positive — the
partner's debt, netted by the next settlement. One OPEN dispute per order;
resolution is a claim on OPEN (two admins → one decision). Settlement itself:
§14.

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

`20260926180000_partner_commerce_final_fixes` (after 7e44ad8) is additive
too. It renames in place, keeping every row: `HANDED_OVER → DELIVERED`,
`PARTNER_ORDER_HANDED_OVER → PARTNER_ORDER_DELIVERED`,
`PARTNER_ORDER_ESCROW → PARTNER_ORDER_MONEY_ESCROW`, `handedOverAt/By →
deliveredAt/By`. It refuses to run while a DISCOUNT leg is CAPTURED in the
old shared escrow (none can exist where v2 was never deployed). It backfills
the Q9 breakdown on earlier returns/refunds (gross = net, nothing
recovered), stamps existing QR purchases LEGACY_V1 and adds CHECKs (legs'
refunded + retained ≤ amount, discount never retained, return/refund
breakdowns reconcile, an executed row recovered exactly its shortfall,
withholding amounts, cancellation cost = external + money ≤ claimed) and
partial unique indexes (one active cancellation per order, one open refund
per QR purchase). Verified on an empty DB, on a populated base-branch DB
(snapshots identical, no drift) and on a DB in the 7e44ad8 state with v2
rows written by the 7e44ad8 code (renames and backfill as expected, the
guard refuses a captured discount leg, and the new code then drives every
in-flight old row — delivered order, old MANUAL_REVIEW return, pending
external refund, submitted order, pending QR — to a consistent end with
every account replaying and all escrows and clearing at zero).

## 10. Cancellation (item 8)

Before the stock is confirmed (DRAFT, SUBMITTED, SEEN, OUT_OF_STOCK), or
when the order carries no cancellation terms, a customer cancellation is
immediate and full. After that it is `CANCELLATION_REQUESTED`: the partner,
on shift, either declares "no costs" (full refund) or claims an actual cost
with amount, reason and evidence → `CANCELLATION_REVIEW`. An unanswered
claim window (`PARTNER_ORDER_CANCELLATION_CLAIM_HOURS`, default 24) means no
claim — full refund. TuTak approves, reduces or rejects (one decision,
audited). Only the approved amount counts, and it comes only from real
money: confirmed external cash first (the partner keeps it), then the TuTak
money escrow → PARTNER_PAYABLE. It can never exceed the real money on the
order; the discount always goes back in full; anything above is never
charged. No fixed or percentage penalty, no commission and no distribution
on a cost. The customer may withdraw the request until TuTak decides;
dispatch is blocked while a request is open.

## 11. TuTak Web Checkout (Q12)

`apps/checkout` — a lightweight customer-facing Next.js app:
partner website → `${CHECKOUT_WEB_BASE_URL}/o/<orderId>` → TuTak login (OTP;
no guest checkout) → review → payment parts → «Подтвердить заказ». It calls
the same API endpoints as the app (same state machine, ledger, order and
idempotency key), offers «Открыть в TuTak» (`tutak://checkout/<id>`), and
does not require the app. The create-order response carries `checkoutUrl`
and `appCheckoutUrl`.

Deployment (not done here): host the app, set `NEXT_PUBLIC_API_BASE_URL`,
add its origin to the API CORS allowlist (`CORS_ORIGINS`) and set
`CHECKOUT_WEB_BASE_URL` on the API.

## 12. Configuration added by the final fixes

| Env | Default | Meaning |
|---|---|---|
| `FINANCIAL_POLICY_V2_EFFECTIVE_AT` | unset = already effective | QR purchases created from this instant are COMMERCE_V2 (Q9) |
| `PARTNER_ORDER_CANCELLATION_CLAIM_HOURS` | 24 | the partner's window to claim an actual cancellation cost |
| `CHECKOUT_WEB_BASE_URL` | unset (no `checkoutUrl`) | public base URL of `apps/checkout` |

## 13. Integration with main's money contour (merge of 2026-09-26)

Main gained, in parallel, a provider route for QR purchases (`PaymentRoute`,
`PspPaymentAttempt`, Idram adapter), per-unit contribution rules with
maker/checker, dual-control refund requests, customer cancellation of a QR
purchase and a partner settlement engine. Merged as follows — no business
rule of either side was changed:

- **One distribution implementation.** `settlePurchase` keeps main's shape
  (the pool from the purchase's snapshotted contribution rule; reads through
  the caller's transaction for a provider callback) and hands the split to
  `CommissionDistributionService` (`planForPool`), which online orders use
  too. Main's connection-pool fix (every `accountFor` takes `tx`) is ported
  into that service.
- **One purchase, one money route.** TuTak money cannot be combined with
  `TUTAK_PSP`: the money leg is released by the cashier's confirmation, and
  a provider-routed purchase is never confirmed at the till.
- **Customer cancel** of a QR purchase returns its TuTak-money part from the
  money escrow in the same transaction as the claim (like reject/expiry).
- **Refunds.** Main's route guard (provider-collected purchases cannot be
  refunded by hand) runs before the COMMERCE_V2 branch; an approved refund
  request may produce a V2 refund awaiting desk settlement.
- **Shifts (Q4).** A provider confirmation has no employee and is not
  shift-stamped; every cash-desk action by a person still is.
- **Settlement engine** — resolved by the owner (§14): main's
  `PartnerSettlementService` is the one engine; Partner Commerce kinds are
  classified into its allow-list, and `settlementPeriodicity` is the one
  cadence.

## 14. Settlement: one engine (owner's decision, 2026-09-26)

`PartnerSettlementService` (main) is the **only** thing that pays a partner.
A posting on `PARTNER_PAYABLE` is paid when a `PartnerSettlementEntry` claims
it — at most once, ever (`ledgerPostingId` unique, a database invariant);
maker/checker and the bank transfer are main's, unchanged. Partner Commerce
adds no payout lifecycle of its own.

**Allow-list.** Every Partner Commerce kind on `PARTNER_PAYABLE` is named
exactly in `SETTLEABLE_LEDGER_KINDS` (no wildcard); a kind added later stays
unpaid and is reported by `unrecognisedKinds()` until someone classifies it.

| kind | source | on PARTNER_PAYABLE | meaning | class |
|---|---|---|---|---|
| `partner_order.completion` | PartnerOrder | CREDIT | electronic part (money + discount) of a received order, released from both escrows | SETTLEABLE |
| `partner.contribution` | PartnerOrder / PurchaseIntent | DEBIT (CREDIT for a PARTNER referrer) | commission (pool) on the full total, incl. external cash | SETTLEABLE (existing) |
| `partner.contribution_refund` | PartnerOrderReturn / PurchaseIntentRefund | CREDIT (DEBIT for a PARTNER referrer) | commission reversed on a return, minus a Q8 withheld share | SETTLEABLE (existing) |
| `partner.bonus_redemption_compensation(_refund)` | PurchaseIntent(Refund) | CREDIT / DEBIT | QR discount compensation | SETTLEABLE (existing) |
| `partner_order.return_money` | PartnerOrderReturn | DEBIT | TuTak money refunded to the customer (net of Q9 shortfall) | SETTLEABLE |
| `partner_order.return_discount` | PartnerOrderReturn | DEBIT | discount restored to the customer | SETTLEABLE |
| `partner_order.shortfall_settled_at_desk` | PartnerOrderReturn | DEBIT | Q9 shortfall the partner kept from the cash / collected | SETTLEABLE |
| `partner_order.cancellation_cost` | PartnerOrderCancellation | CREDIT | money part of an approved actual cancellation cost | SETTLEABLE |
| `order_dispute.hold` / `order_dispute.release` | OrderDispute | DEBIT / CREDIT | freeze / release of a disputed share | SETTLEABLE |
| `purchase_intent.money_release` | PurchaseIntent | CREDIT | TuTak-money part of a confirmed QR purchase | SETTLEABLE |
| `purchase_intent.money_refund` | PurchaseIntent(Refund) | DEBIT | QR refund of the TuTak-money part | SETTLEABLE |
| `purchase_intent.shortfall_settled_at_desk` | PurchaseIntentRefund | DEBIT | Q9 shortfall kept from a QR cash refund | SETTLEABLE |
| `referral.withholding_recovered` | ReferralWithholding | CREDIT | Q8 commission refund, credited as the referrer repays | SETTLEABLE |

External cash/card is never posted, so it is never paid twice; sourcing
price adjustments move only escrow and are released by `partner_order.completion`.

**Disputes.** The hold is a deduction: while a dispute is open the frozen
share is never payable. `createDraft`, `OrderDisputesService.open`, `approve`,
`markPaymentPending`, `markPaid` and `revokeApproval` take the same partner row
lock. A dispute opened once the order credit is in an APPROVED-or-later
settlement freezes nothing (`openedAfterSettlement`), so the engine guards the
settlement itself:

| situation | rule |
|---|---|
| READY, dispute changed a claimed order credit | `approve` refuses (`OPEN_DISPUTE_NOT_IN_SETTLEMENT` / `DISPUTE_REFUND_NOT_IN_SETTLEMENT`) — cancel and draft through now |
| APPROVED / PAYMENT_PENDING / FAILED, an OPEN order dispute whose hold is not in it (or none, opened after approval) | `markPaid` and `markPaymentPending` refuse `OPEN_DISPUTE_NOT_IN_SETTLEMENT`: nothing posted, status unchanged; `revokeApproval` refuses `OPEN_DISPUTE_PENDING_RESOLUTION` — wait for the decision |
| decided for the partner | nothing blocks; the approved settlement is paid as it is |
| decided for the customer / split, and provably no money moved (APPROVED; or FAILED, see below) | `markPaid` / `markPaymentPending` refuse `DISPUTE_REFUND_NOT_IN_SETTLEMENT`; `revokeApproval` → CANCELLED (approval kept as history), claims released, **no draft** — the credit and the refund are unsettled again and go into the next closed-period draft of the cadence |
| decided for the customer, a transfer may have moved money (PAYMENT_PENDING; REQUIRES_RECONCILIATION; FAILED that is not provable; any paid posting) | `revokeApproval` refuses `TRANSFER_MAY_HAVE_STARTED`, claims stay; the transfer / reconciliation lifecycle finishes it and the refund is debt netted by the next settlement |

"Provably no money moved" is checked on data (`transferEvidence`). Common to
all: no `partner.settlement.paid` posting, no attempt that succeeded, none
unresolved. APPROVED: nothing ever tried — no attempt, no bank reference, no
`settlement.payment_pending` audit event. FAILED, one of two ways: the bank's
unambiguous refusal (`markFailed`, never reconciled, no reference on the
settlement); or a two-person confirmed MONEY_DID_NOT_MOVE — that confirmation
is the proof for the attempt it decided, and a reference that attempt or a
retracted MONEY_MOVED reading left on the row is not held against it, but
anything tried *after* the confirmation (a transfer attempt, a
PAYMENT_PENDING) makes the settlement unprovable until it is reconciled again.
Confirming a reconciliation resolves the ambiguous attempt in place, so the
record shows which attempt was decided. A refund counts as "not in the
settlement" while its return is not written yet, waits on the desk (Q9), or
has PARTNER_PAYABLE postings this settlement does not claim. Nothing is
frozen for a dispute opened after approval and no hold is created later: the
settlement waits for the decision, and cannot be revoked meanwhile. Drafts
are only ever cut by an administrator for a closed period of the cadence — a
revoke never drafts, so a correction cannot become an extra settlement period
(owner's decisions, 26.09.2026).

**One cadence.** `Partner.settlementPeriodicity` (+ `settlementAnchorDay`) —
DAILY (added), WEEKLY, BIWEEKLY, MONTHLY; bounds in `settlement-period.ts`
(Yerevan midnights). `createDraftForClosedPeriod` drafts the last closed
period. Partner Commerce's `settlementPeriod` was dropped by
`20260926200100` after a guard that STOPS if an explicitly set value (audited
`PARTNER_SETTLEMENT_PERIOD_CHANGED`) differs from `settlementPeriodicity`.
`PartnerSettlementCheckService` is main's, unchanged (its fixed 14 days).

**Statements** are a read-only report (`PartnerSettlementStatementService`):
for a period of the cadence, every PARTNER_PAYABLE / HOLD posting with the
settlement that claimed it, or its class (unsettled / transfer / not
settleable). Nothing stores or claims; the old statement tables are kept as
history, no longer written, and the statement sweep is gone.

