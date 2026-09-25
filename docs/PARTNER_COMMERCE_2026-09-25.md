# Partner Commerce — design & audit record (2026-09-25)

A partner's own public website ("Little Joe", "Euro Import" and future ones)
can sell through TuTak: the customer checks out on TuTak (wallet, bonus,
IDRAM later), TuTak hands the order to the partner to fulfil, TuTak collects
a configurable commission, and TuTak's own staff can source an out-of-stock
item elsewhere before refunding. This document is the audit this task
started from (§30 of the task spec) and the architecture decisions made on
top of it — read it alongside the final Russian report, which is the
authoritative status/coverage statement.

## 1. Audit — what already existed and was reused

| Need | Existing primitive reused | Notes |
|---|---|---|
| Double-entry money movement | `LedgerService.post/reverse/accountFor/replayBalance` | New account type `PARTNER_ORDER_ESCROW` added; every posting still goes through `post()`. |
| Real-money customer balance | `CustomerBalanceService` / `CUSTOMER_PREPAID_BALANCE` | Was closed-loop to roaming-CPO charging only; see §3 below — extended with an explicit, documented decision, not silently. |
| Server-to-server partner credential | `PartnerIntegration(type: WEBSITE)` + `PartnerApiKey` | Already built as exactly this extension point (see that enum's own docblock, predates this task). Moved `PartnerApiKeyService` from `roaming-cpo` to `partners` since it is generic, not roaming-specific — zero behavior change, only import paths. |
| Website verification lifecycle | `PartnerIntegrationsService.markWebsiteVerified` | Unchanged; a `WEBSITE` integration must be admin-verified before its API keys can create orders. |
| Order-like entity template | `PurchaseIntent` | Commercial snapshot frozen at creation, claim-then-act state transitions, idempotent terminal transitions — `PartnerOrder` follows the same shape. |
| Admin "needs attention" queue | `FraudSignal` / `FraudDetectionService` | `OrderEscalation`/`SourcingTask` follow the same `resolvedAt: null` query shape; added a `claim` step this precedent has no equivalent of. |
| SLA timers | `sweeps.jobs.ts`'s deadline-column + polling-sweep pattern (`purchase-intent.expire`) | Two new sweeps, no new delayed-job mechanism — this codebase does not have one and the task explicitly says not to build unreliable in-process `setTimeout`s. |
| RBAC | `RolesGuard`/`PermissionsGuard`/`assertPartnerScope` | One new `PermissionName.PARTNER_ORDER_MANAGE`, granted to the same population `PURCHASE_INTENT_CONFIRM` already is. |
| AuditLog | `AuditService.record` | New `AuditAction` values only. |

Real gap found: **no IDRAM (or any real bank/PSP) integration exists in this
codebase** — only `BankTopUpAdapter`/`PspAdapter` interfaces with
no-op/sandbox implementations. Confirmed with Арман (2026-09-25): build
everything up to that boundary now, connect a real adapter later.

## 2. Why `PartnerOrder` is one universal entity

Spec §4/§20's own example — Euro Import's vehicle price never touching
TuTak, only the service fee — needs no special modelling: the partner's own
website simply never puts the vehicle price into the `items` it sends to
`POST /partner-orders`. TuTak has no "vehicle" concept and never needs one.
The boundary of what "goes through TuTak" is exactly the boundary of what
the partner's site put in the order.

## 3. Money: escrow, not a fake hold

The AMD ledger has no authorize/capture-hold primitive — `LedgerService.post`
is immediate and final, and building one was explicitly out of scope for
this pass (Арман, 2026-09-25: "immediate capture + reverse"). So:

1. `pay()` captures the order's full total from `CUSTOMER_PREPAID_BALANCE`
   into a new **`PARTNER_ORDER_ESCROW`** account (per-partner, like
   `PARTNER_PAYABLE`), atomically claiming the order for that customer in
   the same transaction.
2. `confirmStock()` releases escrow: `partnerAmount` → `PARTNER_PAYABLE`,
   `commissionAmount` → `PLATFORM_REVENUE`, one balanced three-leg posting.
3. A refund (sourcing disabled, sourcing failed, product not found, or a
   declined adjustment) moves the captured amount back to
   `CUSTOMER_PREPAID_BALANCE` instead.

This is a real financial decision extending `CUSTOMER_PREPAID_BALANCE`
beyond its previous closed-loop restriction (2026-08-29: roaming-CPO
charging only). Documented explicitly, in both places the original decision
lived: `CUSTOMER_PREPAID_BALANCE`'s own schema docblock and
`CustomerBalanceService.collectFromBalance`'s docblock. Two named spenders
now, `collectFromBalance` and `debitForPartnerOrder`/
`creditFromPartnerOrderEscrow` — never a generic "spend my balance" helper,
and bonus points still cannot fund it.

No bonus-point payment at PartnerOrder checkout in this pass — checkout is
real-money (`CUSTOMER_PREPAID_BALANCE`) only. Spec §5 asks for "доступные
бонусы, если применимы"; mixing a bonus reservation with a real-money
capture in one checkout step was judged out of scope for this size of task.
See the final report's open-questions section.

## 4. Order state machine

```
CREATED --pay()--> PAID --markSeen()--> PARTNER_SEEN
PAID | PARTNER_SEEN --confirmStock()--> STOCK_CONFIRMED
PAID | PARTNER_SEEN --rejectStock(), sourcingAllowed=true--> SOURCING_REQUIRED
PAID | PARTNER_SEEN --rejectStock(), sourcingAllowed=false--> OUT_OF_STOCK --> REFUNDED

SOURCING_REQUIRED --claim()--> (no status change; SourcingTask.status=SEARCHING)
SOURCING_REQUIRED --recordResult(NOT_FOUND)--> REFUNDED
SOURCING_REQUIRED --recordResult(FOUND_EXACT, same price)--> STOCK_CONFIRMED
SOURCING_REQUIRED --recordResult(FOUND_EXACT, cheaper)--> STOCK_CONFIRMED (auto refund of the difference)
SOURCING_REQUIRED --recordResult(FOUND_EXACT pricier | FOUND_ALTERNATE any price)--> CUSTOMER_DECISION_REQUIRED

CUSTOMER_DECISION_REQUIRED --adjustments.respond(decline)--> REFUNDED
CUSTOMER_DECISION_REQUIRED --adjustments.respond(accept), delta<=0--> STOCK_CONFIRMED
CUSTOMER_DECISION_REQUIRED --adjustments.respond(accept), delta>0--> (waits for payAdditionalAmount) --> STOCK_CONFIRMED
```

`ACCEPTED → PREPARING → READY → SHIPPED/PICKUP_READY → COMPLETED` (spec
§11's post-confirmation fulfilment tail) are declared in the
`PartnerOrderStatus` enum but have **no transition endpoint built in this
pass** — spec gives no business rule distinguishing them beyond "continues
normally," so no code was written that would only exist to satisfy an
enum's own completeness. See open questions.

`CANCELLED` is declared but unreached by any code path in this pass — no
current flow calls for a partner- or admin-initiated cancellation distinct
from a refund. Left in the enum for a future, explicit decision rather than
removed and re-added later.

## 5. Commission

`CommissionRule` — partner-scoped, optionally category-scoped, resolved by
`CommissionRuleService.resolve` with precedence partner+category >
partner-only > `purchasePolicy.partnerOrderDefaultCommissionBps` (config,
default 5%). Snapshotted onto the order (`commissionRuleId`,
`commissionRateBps`) at creation — a later rule change never touches an
order already placed. No hardcoded per-partner percentage anywhere.

## 6. SLA and escalations

`sweeps.jobs.ts` gained two rows, `partner-order.not-seen-alert` (every 30s,
checks the 5-minute deadline) and `partner-order.stock-not-confirmed-alert`
(every 60s, checks the 30-minute deadline then every 5 minutes after).
`OrderEscalation` records each alert and supports "взял в работу" (claim) —
claiming stops further *pushes* for that specific problem without hiding
the order from the admin queue, which still reads `PartnerOrder` state
directly. **No push/device notification is sent** — the escalation queue
itself is the alerting surface, exactly like `FraudSignal`'s own
queue-with-no-push precedent. See open questions.

## 7. What this pass did not build

- Real IDRAM/bank adapter (explicitly deferred, confirmed with Арман).
- Bonus-point partial payment at PartnerOrder checkout.
- `ACCEPTED`/`PREPARING`/`READY`/`SHIPPED`/`PICKUP_READY` transition
  endpoints and their own business rules.
- Push notifications to ADMIN/SUPER_ADMIN devices for escalations (queue
  only, matching `FraudSignal`).
- Admin UI for `CommissionRule` CRUD (API + service exist; only wired into
  the sourcing/escalation admin pages, not a dedicated commission screen).
- Deep-link queuing for a `tutak://checkout/...` link that arrives before
  the customer is signed in.
