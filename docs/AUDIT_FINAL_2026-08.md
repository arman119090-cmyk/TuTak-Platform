# TuTak — final audit report, August 2026

State audited: commit `9190116` + adversarial probe suite. **263 tests passing**
(55 unit, 208 integration), lint clean, typecheck and build green across all
four applications.

This is an audit by the code's own author. That is worth less than an
independent one: I found real holes in my own previous fixes twice during this
work, which shows both that skepticism helps and that it is not sufficient.
Commission an outside review before production.

---

## 1. Missing modules vs real bugs

The distinction matters more than anything else in this report. Several
subsystems referred to as if they exist have **no code at all**. Their absence
is not a defect to fix — it is scope that was never built.

| Subsystem | Files | Status |
| --- | ---: | --- |
| Telegram Bot | 0 | **Does not exist.** No dependency, no code, no reference anywhere in the repository. |
| Payments / PSP | 0 | **Does not exist.** Matches on "payment" are the `qr-payments` module name. Nothing charges anyone. |
| Settlement | 0 | **Does not exist.** Matches are code comments recording its absence. |
| Payouts to partners | 0 | **Does not exist.** |
| Refunds | 0 | `TransactionType.REFUND` is in the enum and is never produced. |

Everything below this line is a **real bug in code that exists**.

---

## 2. Confirmed Critical

### C-1 — No payment collection, so no "payment" is real
`TransactionsService.create()` writes a row; nothing charges anyone. Every
amount is asserted by the payer or the merchant, and bonus accrues against
revenue that was never collected.

*Exploit:* a colluding merchant issues invoices at any amount; both sides split
the accrual at zero cost. *Impact:* the loyalty currency has no funding model.
*Fix:* build payment authorization and settlement. Not patchable — a fraudulent
redemption is indistinguishable from a real one while the payment is
self-asserted. This is why `STATIC_MERCHANT` redemption is currently disabled.

### C-2 — Phone verification cannot operate; the API will not boot
The verification and reset flows are implemented and tested, but no carrier
account exists, so `SMS_ENDPOINT` is unset. Production deliberately **refuses
to start** without it, rather than silently logging codes.

*Impact:* the platform cannot be deployed at all until an SMS account is
purchased. *Fix:* provision Twilio or a local Armenian gateway; set the six
`SMS_*` variables.

---

## 3. Confirmed High

| | Finding | Why it matters | Fix |
| --- | --- | --- | --- |
| **H-1** | OCPI client never run against a live CPO; credentials exchange (Token A → Token C) not implemented | Written to spec and typechecked, zero runtime verification | Obtain FastCharge credentials, implement the handshake, test against their sandbox |
| **H-2** | Compensation and referral qualification are fire-and-forget | `transaction.completed` is an in-process event with no outbox; a process death between `markCompleted` and the listener silently loses a referral, and saga rollback has the same shape | Durable outbox with at-least-once delivery |
| **H-3** | In-process cron will double-fire on a second replica | All four sweeps run via `@Cron` in every instance. Invisible at one replica; every sweep runs twice at two. Redis is provisioned and used by nothing | Leader election or a Redis lock; back the throttler with Redis while there |
| **H-4** | `bonus_ledger_delta_matches_direction` is `NOT VALID` | Enforced on all new writes, unproven for 48 legacy rows | Delete or reconstruct those rows, then `VALIDATE CONSTRAINT` |

---

## 4. Confirmed Medium

- Referral floor hardcoded at 1000 while the reward is env-configurable —
  raising `REFERRAL_REWARD_AMOUNT` silently breaks the economics.
- `manualAdjustment` has no ceiling and no dual control; one admin can credit
  up to `MONEY_MAX` in a single call.
- Audit log documented as immutable with no database enforcement (no revoked
  grants, no trigger, no hash chain).
- `partnerAnalytics` `groupBy(['userId'])` still returns one row per distinct
  customer — better than loading every transaction, still unbounded.
- Missing `[status, expiresAt]` indexes on `bonus_reservations` and
  `ev_reservations`; both sweeps scan every minute to five minutes.
- Per-request RBAC runs a three-level join with no cache.
- Mobile `app.json` still points at `http://localhost:4000`.

## 5. Confirmed Low

Dead code (`OcpiAdapter.fetchCdr`, mobile `evApi.startSession`/`stopSession` —
the EV journey has no UI beyond browsing stations) · `USER_PAY_TOKEN` is
semantically inverted (only its own issuer could ever redeem it, and that is
now refused) · `User.deletedAt` never set, so no GDPR erasure path ·
correlation id present only on 5xx responses.

---

## 6. What was proven, and what could not be

**Seventeen attacks written from the attacker's goal** (not from the shape of
past fixes) in `test/adversarial-probe.int-spec.ts`. All refused:

bonus inflation via merchant-invoice loop and via ten repeated EV sessions ·
accrual-rate manipulation · concurrent double spend · key replay · double
settle · concurrent triple reversal · wallet driven negative via API and via
raw SQL · contradictory ledger entry · ledger replay across the full operation
vocabulary in one sequence · privilege climb from `PARTNER_OWNER` · self-grant
at every rank · metering and stopping another customer's session ·
twenty-account referral farm · platform-wide equality between wallet totals and
the summed ledger · audit row per redemption.

**Not verifiable automatically, and why:**

| Claim | Why not |
| --- | --- |
| OCPI correctness | No CPO server to call |
| SMS delivery | No carrier account |
| Payments, settlement, Telegram | No code to test |
| Outbox durability | Requires killing the process mid-transaction |
| Multi-replica cron safety | Requires two replicas |
| Behaviour under real load | Only targeted races are covered; nothing has run under contention |

---

## 7. Beta blockers

1. **C-2 — SMS account.** The API will not boot without it. Hard blocker.
2. **Open registration is still free.** Verification now gates *earning*, which
   contains the economic damage, but an open Beta with a valuable currency and
   no payment funding remains exposed. A closed, invited Beta is defensible.

Nothing else blocks a closed Beta. Money movement is well covered.

## 8. Production blockers

1. **C-1 — no payment collection or settlement.** A loyalty platform that never
   collects money cannot go to production. This is the missing half of the
   product, not a bug.
2. **No refund path.** A refunded purchase leaves its accrued bonus granted
   permanently.
3. **H-1 — OCPI unverified** against any real network.
4. **H-3 — cron breaks on the second replica**, i.e. on the first horizontal
   scale-out.
5. **No independent security review.** See the caveat at the top.

---

## 9. Scores

| Dimension | Score |
| --- | ---: |
| Production readiness | **31 / 100** |
| Security | **72 / 100** |
| Architecture | **60 / 100** |
| Code quality | **80 / 100** |

Security is the genuine strength: the reachable attack surface is well
defended and covered by tests that fail when the guards are removed.
Architecture sits lower than the code quality would suggest because the gaps
are structural — no payment layer, no outbox, replica-unsafe scheduling.

**Beta:** conditionally yes, closed group, after buying SMS.
**Production:** no.

---

## 10. Next five tasks, in priority order

1. **Provision SMS and verify the flow end to end.** Half a day. Unblocks
   deployment entirely; without it nothing else can be tested on real devices.
   Verify a real code arrives, is accepted, and gates earning as designed.

2. **Design and build payment authorization and settlement.** Weeks, and the
   single largest piece of remaining work. Until money is actually collected,
   the bonus economics are unfunded and `STATIC_MERCHANT` stays disabled.
   Include the refund path in the design — retrofitting it is far harder.

3. **Add a durable outbox for domain events.** Days. Closes H-2, and makes
   saga compensation and referral qualification survive a process death.
   Prerequisite for trusting the system under any real failure rate.

4. **Make scheduled work replica-safe.** Hours. Leader election or a Redis
   lock around the four sweeps, plus backing the throttler with the Redis
   instance already provisioned and unused. Do this before the second replica,
   not after.

5. **Commission an independent security audit.** The work above changes the
   money paths substantially, so review after it lands rather than now. Treat
   this report as input to that review, not a substitute for it.
