# Roaming-CPO wholesale-resale integration

> **Amendment, 2026-08-26 (Arman):** "все станции могли заряжаться только из
> нашего application исключительно" / "кошелёк только наш" — every station a
> customer can find in the app must be chargeable, and paid for, through
> TuTak alone. Roaming-CPO stations cannot meet that today: TuTak has no
> start/stop command for one (see requirement 1 below), and the customer pays
> the partner directly, not through the TuTak wallet. Per Arman's decision,
> `ROAMING_CPO`-provider stations are now excluded from every customer-facing
> discovery endpoint (`EvStationsService.listNearby` — see
> `ev-stations-nearby.int-spec.ts`) and from the mobile map/list. The
> settlement pipeline below (`RoamingCpoSettlementService`, the wholesale
> margin split, cashback from that margin) is unchanged — this amendment is
> about what a customer can *find and start in the app*, not about the
> revenue-share relationship with the partner itself.
>
> **Update, 2026-08-27 (Arman):** this integration was briefly deleted
> outright, then reinstated and generalized under the `ROAMING_CPO` name
> (previously `FASTCHARGE`) — TuTak has since moved on from FastCharge to a
> different EV-charging partner on better terms, and this structure (station/
> customer sync, wholesale/margin economics, M2M API keys, settlement) is
> exactly what the new partner will use, just without hardcoding a brand name
> into the code or schema. Every identifier below has been renamed
> accordingly; the worked examples and requirements are otherwise unchanged.
>
> **Migration-history note, 2026-08-29:** the reinstatement above shipped as
> two migrations — the original `..._fastcharge_integration` (never renamed,
> so it still created `fastcharge_customer_links` and the `FASTCHARGE` enum
> value under the old brand) plus a second `20260827000000_reinstate_roaming_cpo`
> that tried to recreate the same structure under the generic name without
> knowing the brand-named version already existed on a fresh database. That
> collided on every column, table and index the first migration already
> created (`ev_connectors.externalConnectorId`, `partner_api_keys`, and so
> on) and failed CI. Both are consolidated here into one migration,
> `20260825143028_roaming_cpo_integration`, which creates the final
> `ROAMING_CPO`-named schema directly — no `FASTCHARGE` enum value or
> `fastcharge_customer_links` table is ever created, not even transiently.
> This is safe because no environment in this repository's CI/CD ever runs
> `prisma migrate deploy` against anything but a disposable, freshly-created
> service container (`ci.yml`'s Postgres service, or this session's own
> sandbox) — there is no deploy workflow, no persisted staging/production
> database, and this branch has never been merged — so repository evidence
> shows neither of the two replaced migrations was ever applied to a real
> environment. `docs/ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md` covers
> everything else that changed in the same pass (station capabilities,
> the Start/Stop saga, frozen-rate accounting, and removing customer-facing
> external-account linking).

**Delivered:** 2026-08-25.
**Branch:** `claude/tutak-loyalty-mvp-e485jm`.
**Base:** `59a8b12` (`docs: record this pass's own commit SHA in the hardening report`), on top of the collections-hardening pass (83/83 suites, 1199/1199 tests at that point).
**This pass's commit:** `f953d80` (`feat: roaming-CPO wholesale-resale EV charging integration`).

This is a new integration built on existing rails, not a parallel system: it
reuses `EvStation`/`EvConnector`/`EvSession`/`EvCdr`, the exact 20/30/30/10/5/5
`ReferralService.computePoolSplit` six-leg rule, `IdempotencyService`,
`LedgerService.post`, `OutboxService`, `BonusEngineService`,
`DeferredBonusLotService`, and the Serializable-retry idiom
`EvSessionsService`/`ReferralService` already use. Nothing about QR purchases,
`PurchaseIntent`, the standard referral model, or the existing internal/OCPI
EV flow was changed — `ev-charging.int-spec.ts`'s full 18-test suite passes
unmodified, proving that.

---

## The business model, precisely

The roaming-CPO partner is a third-party EV network. TuTak buys energy from them at a
contractual wholesale rate (`Partner.evWholesaleRatePerKwh`, defaulting to the
75 AMD/kWh Arman quoted) and resells it at whatever tariff the partner actually
applied to a given customer for a given session
(`appliedCustomerRatePerKwh` — station tariffs and per-customer negotiated
rates both come from the partner's own report, never inferred). The difference
is TuTak's margin:

```
margin = appliedCustomerRatePerKwh − wholesaleRatePerKwh   (floored at 0)
```

Of that margin, only `min(margin, marginReferralCapPerKwh)` AMD/kWh
(`Partner.evMarginReferralCapPerKwh`, defaulting to 20) enters the ordinary
green/deferred/L1/L2/L3/TuTak split — the exact same
`ReferralService.computePoolSplit` call, on the exact same config bps
(`poolGreenBps=2000`, `poolDeferredBps=3000`, `poolReferrerL1Bps=1000`,
`poolReferrerL2Bps=500`, `poolReferrerL3Bps=500`, residual to TuTak) that
prices a confirmed `PurchaseIntent` or an internal `EvSession`. Margin above
the cap is undivided TuTak revenue and never touches the split, not even
TuTak's own residual share of it.

`RoamingCpoSettlementService.computeMargin` is the whole of this arithmetic,
in one pure static method — `roaming-cpo-settlement.service.spec.ts` proves it
directly against Arman's worked examples:

| Applied rate | Margin | Through the split (`pool`) | Straight TuTak revenue (`uncappedRevenue`) |
|---|---|---|---|
| 80 AMD/kWh | 5 | 5 | 0 |
| 105 AMD/kWh | 30 | 20 | 10 |
| 120 AMD/kWh | 45 | 20 | 25 |

Cap-boundary cases (exactly at 20, one under, one over) are also asserted.
`roaming-cpo-settlement.int-spec.ts` re-derives the same numbers end to end —
real database, real wallet, real double-entry ledger — and additionally
asserts the 105-AMD/kWh case's exact ledger postings: **300 AMD debited** from
the partner's `PARTNER_PAYABLE` (200 capped pool + 100 uncapped,
for a 10 kWh session), **100 AMD credited** to `BONUS_LIABILITY` (green 40 +
deferred 60, no referrer in that scenario), **200 AMD credited** to
`PLATFORM_REVENUE` (the pool's 100 residual + the 100 uncapped) — 300 debit =
100 + 200 credit, balanced.

---

## Data model

One additive, safe migration:
`apps/api/prisma/migrations/20260825143028_roaming_cpo_integration/migration.sql`
— every new column is nullable or has a backfill-safe default, every new
table is genuinely new. Nothing pre-existing was dropped, renamed, or made
non-nullable.

**Extended, not duplicated** (per the brief's "extend, don't build parallel"
instruction):

- `EvStation` +`provider` (new `EvStationProvider` enum: `INTERNAL` |
  `ROAMING_CPO`, default `INTERNAL` — a no-op for every existing row),
  `+externalStationId` (unique, the partner's own station id),
  `+standardRetailRatePerKwh` (the station's current walk-in tariff, display
  only).
- `EvConnector` +`externalConnectorId` (unique, the partner's own
  connector/EVSE id — deliberately separate from the existing `ocpiEvseUid`,
  which is the *roaming-OCPI command* identity roaming-CPO sessions never use;
  see "Why not the existing OCPI adapter" below).
- `EvSession` +`externalSessionId` (unique — the idempotency
  backstop), `+externalCustomerId`, `+stationRetailRatePerKwh`,
  `+appliedCustomerRatePerKwh`, `+wholesaleRatePerKwh`,
  `+marginReferralCapPerKwh`, `+marginPerKwh`, `+uncappedMarginRevenueAmount`.
  The session's existing `poolAmount`/`greenAmount`/`deferredAmount`/
  `referrer1..3*`/`tutakAmount`/`programVersion` columns are **reused
  unchanged** — they are already generic enough (see their own docblocks) to
  carry the roaming-CPO-margin-based pool split exactly as they carry the
  internal accrual-rate-based one.
- `Partner` +`evWholesaleRatePerKwh` (`Decimal(10,2)`, default `75.00`)
  +`evMarginReferralCapPerKwh` (`Decimal(10,2)`, default `20.00`) — both
  configurable per partner, read nowhere as a literal; every read is gated on
  the session's station actually being `ROAMING_CPO`-provider.

**New, genuinely new:**

- `RoamingCustomerLink` — the `User` ↔ roaming-CPO-customer-id mapping,
  `@@unique([partnerId, externalCustomerId])`. Created only by
  `RoamingCpoCustomersService.link`, called by an authenticated TuTak user
  naming their own roaming-CPO customer id — **never** created implicitly by
  the settlement webhook. A settlement for an unlinked customer id is
  rejected outright (`roaming-cpo-settlement.int-spec.ts`, "customer linking"
  block).
- `PartnerApiKey` — the M2M credential, hung off the existing
  `PartnerIntegration` extension point (`integrationId` is optional, nullable
  FK). Only a SHA-256 hash of the secret is stored; the plaintext is returned
  once, at issuance, by `PartnerApiKeyService.issue`.

**Why `EvStation`, not `PartnerBranch`, is the multi-location mechanism:**
`PartnerBranch` is QR/`PurchaseIntent`'s own "one partner, many shop fronts"
model — a branch has no connectors, no tariff, no session concept, and
`EvStation` already *is* TuTak's "one partner, many locations, each with its
own connectors and pricing" model, used by every existing EV station
(internal or roaming) today. Building a second "location" concept on
`PartnerBranch` for a roaming-CPO partner specifically would be exactly the kind of
parallel structure the brief says not to build; `EvStation.provider` +
`externalStationId` extends the one that already fits.

---

## `RoamingCpoProvider` — the adapter boundary

**No real partner API documentation exists.** Per requirement 4, this is
built as an internal adapter boundary, not a client for an endpoint that does
not exist. `apps/api/src/modules/roaming-cpo/roaming-cpo-provider.interface.ts`:

```ts
export interface RoamingCpoProvider {
  notifyCustomerLinked(params: {
    partnerId: string;
    externalCustomerId: string;
    tutakUserId: string;
  }): Promise<void>;
}
```

This mirrors the existing `OcpiAdapter`/`OCPI_ADAPTER` DI-token pattern
exactly (`NoopOcpiAdapter` vs. `HttpOcpiAdapter`): `NoopRoamingCpoProvider` is
the only implementation today (logs the notification), registered via the
`ROAMING_CPO_PROVIDER` token in `roaming-cpo.module.ts`. Swapping in a real
`HttpRoamingCpoProvider` once the partner hands over a real endpoint is the
same one-line `useClass` change `EvChargingModule` already does for OCPI — no
caller of `ROAMING_CPO_PROVIDER` needs to change.

The relationship is deliberately the mirror image of the OCPI adapter: TuTak
never calls out to the partner to command a charger (requirement 1).
The partner calls **in** to TuTak instead — two `@Public()` + `x-api-key`-guarded
inbound routes:

- `POST /roaming-cpo/stations/sync` — `RoamingCpoStationSyncDto`: station id,
  name/address/city/coordinates, `standardRetailRatePerKwh`, and an array of
  `{ externalConnectorId, connectorType, powerKw }`. Idempotent upsert keyed
  by the partner's own ids (`RoamingCpoStationsService.sync`).
- `POST /roaming-cpo/sessions/settle` — `RoamingCpoSessionSettleDto`: exactly
  requirement 4's field list (`externalSessionId`, `externalCustomerId`,
  `externalStationId`, `externalConnectorId`, `energyKwh`,
  `appliedCustomerRatePerKwh`, `finalAmount`, optional `bonusAmountToApply`,
  `startedAt`/`stoppedAt`).

And the one thing TuTak owes the partner back (requirement 4: "at minimum, the
linked TuTak user id"): `POST /roaming-cpo/customers/link` is a TuTak-user-
authenticated route (JWT, not M2M) — the customer names their own the partner
account inside the TuTak app, `RoamingCpoCustomersService.link` creates the
mapping and calls `RoamingCpoProvider.notifyCustomerLinked` best-effort
(logged, never blocking the customer's own linking action).

### What a real roaming-CPO partner integration would need to build, once documentation exists

1. **Real endpoints for the two `@Public()` M2M routes above** — the partner's
   backend calling `POST https://<tutak>/v1/roaming-cpo/stations/sync` and
   `POST https://<tutak>/v1/roaming-cpo/sessions/settle` with an `x-api-key:
   <keyId>.<secret>` header, body shaped exactly as the two DTOs above. No
   webhook signature scheme (HMAC-over-body, timestamp/nonce replay
   protection, etc.) is implemented — see "Deliberately left out of scope"
   below for why.
2. **A `notifyCustomerLinked` receiver on the partner's side**, or an
   agreed-upon alternative mechanism, so `HttpRoamingCpoProvider` (the
   eventual real implementation of `RoamingCpoProvider`) has somewhere to
   send the TuTak-user-id mapping.
3. **A settlement/reconciliation process between TuTak and the partner for the
   wholesale cost itself** — this integration records the *margin* correctly
   in TuTak's own ledger (see "Ledger accounting" below) but does not model
   the actual money movement/collection process between TuTak and
   the partner for the wholesale amount owed; that is a real-world commercial
   settlement process outside this codebase's current ledger's scope (see
   "left out of scope").

---

## Immutable snapshots

Every completed `EvSession` freezes, at settlement time, in the same
transaction as its own creation: `stationRetailRatePerKwh`,
`appliedCustomerRatePerKwh`, `wholesaleRatePerKwh`, `marginReferralCapPerKwh`,
`marginPerKwh`, `poolAmount`, `uncappedMarginRevenueAmount`. A later change to
`Partner.evWholesaleRatePerKwh`, `Partner.evMarginReferralCapPerKwh`, or
`EvStation.standardRetailRatePerKwh` only ever affects a *future* settlement —
these columns are read once, at the moment `RoamingCpoSettlementService
.settleOnce` computes the margin, and never again. `roaming-cpo-settlement
.int-spec.ts`'s "immutable snapshots" test proves this directly: it settles a
session, changes the partner's wholesale rate, referral cap, and the
station's retail rate, re-reads the already-settled session and confirms
every one of its stored figures is untouched, then settles a second session
and confirms *that* one picks up the new terms.

The same discipline extends to the admin/partner UI:
`RoamingCpoStationsService.updateTariff` (used by both
`PATCH /roaming-cpo/stations/:id/tariff` and the admin page) only ever writes
`EvStation.standardRetailRatePerKwh` — it has no path back to any
already-created `EvSession` row at all, so immutability holds by construction
rather than by a guard that could be forgotten.

---

## Idempotency, end to end

Two layers, matching this codebase's own dual-layer discipline (the brief's
explicit example: the bank-transaction-control pattern from the collections
hardening pass):

1. **`IdempotencyService.run`**, scoped `roaming-cpo-settle:<partnerId>`, keyed
   by the partner's own `externalSessionId` — the ordinary "a literal retry
   returns the original answer" guarantee every other financial mutation in
   this codebase already gets.
2. **`EvSession.externalSessionId`'s unique index** — the backstop
   for everything the first layer cannot catch (a lost/reclaimed
   `IdempotencyRecord` lease, or two deliveries racing each other directly).
   Postgres aborts a whole transaction on its first statement error, so the
   unique-violation recovery cannot look anything up from inside the same
   transaction that hit it (`current transaction is aborted, commands ignored
   until end of transaction block` — this was caught and fixed during this
   pass's own test run, see the settlement service's docblock on
   `settleOnce`). The recovery runs *after* the failed transaction has fully
   rolled back, reading the concurrent winner's already-committed row
   directly via `this.prisma`, and returns that row's result rather than
   erroring or creating a second one.

`roaming-cpo-settlement.int-spec.ts`'s "idempotency" block proves three
things: a literal duplicate delivery never double-posts (checked at both the
`EvSession` and `LedgerTransaction` level, and that the wallet only saw the
green accrual once); two concurrent deliveries for the same session
(bypassing the `IdempotencyService` layer directly, simulating a lost lease)
still collapse to one row via the unique-index backstop; and a transient
`LedgerService.post` failure is recovered by `OutboxService.drain()` without
double-posting on a second drain — the exact same fast-path-plus-guaranteed-
retry shape `EvSessionsService.postEvContributionLedgerIdempotent` already
uses, reused via a new `roaming-cpo.margin.ledger_post` outbox event
registered the same way `ev.contribution.ledger_post` is.

---

## Ledger accounting

`RoamingCpoSettlementService.postMarginLedgerIdempotent` mirrors
`EvSessionsService.postEvContributionLedgerIdempotent` leg for leg, with one
structural difference explained in its own docblock: that method debits the
*station's own partner* because, in the internal-station program, the
partner funds the bonus pool out of its own accrual rate. Here the margin is
TuTak's own money (The roaming-CPO partner is not funding a bonus programme — TuTak is
reselling wholesale energy) — but the debit is still the partner's
`PARTNER_PAYABLE` account, because The roaming-CPO partner is the one collecting the
customer's payment (the walk-in-equivalent amount, partly outside TuTak per
requirement 2); crediting TuTak's margin out of the partner's payable balance
is what makes a later TuTak↔partner settlement of the wholesale amount net
out correctly — the margin never needs to physically leave the partner's side
to reach TuTak's revenue account. Concretely, per session:

- **Debit** `PARTNER_PAYABLE(fastChargePartner)` for `pool + uncappedRevenue`
  (the full margin).
- **Credit** `BONUS_LIABILITY` for `green + deferred + Σ(USER-type chain legs)`.
- **Credit** `PARTNER_PAYABLE(referrerPartner)` for any `PARTNER`-type chain
  referrer leg (unrelated third-party partner referrals — same as the
  existing EV/PurchaseIntent postings).
- **Credit** `PLATFORM_REVENUE` for `split.tutak + uncappedRevenue` (the
  pool's residual plus the whole uncapped slice).

When the customer is not eligible to earn (unverified phone, or an
affiliated partner-staff self-dealing guard — the exact same M7 guard
`EvSessionsService.stopOnce` already enforces), the *entire* margin (capped
and uncapped) folds into TuTak's own revenue rather than the split — TuTak's
margin is never gated on customer eligibility the way the *distribution* of
it is; see `settleOnce`'s `eligible` branch.

---

## M2M credentials

`PartnerApiKeyService` — a standard public-id + secret pair
(`<keyId>.<secret>`), only the SHA-256 hash of the secret ever persisted,
compared with `crypto.timingSafeEqual` (not `!==`, which would leak a timing
oracle on the hash). `RoamingCpoApiKeyGuard` looks up by the indexed `keyId`
first (no per-request table scan), then verifies the hash, then checks
`revokedAt`. Issuance is platform-admin-only (`RoamingCpoController
.issueApiKey`, `assertPlatformAdmin`) — per requirement 3's "not a human
login/password", a roaming-CPO credential is provisioned by TuTak's own team
during onboarding, not self-served by a partner login. Listing (masked — no
secret ever returned again) and revocation are partner-scoped
(`assertPartnerScope`), so a partner can see what is issued and pull the plug
without needing TuTak's team.

---

## Bonus-partial-payment

Reuses `PurchaseIntent`'s exact shape and exact ceiling — no second
bonus-redemption path: `bonusAmountToApply` is validated against the
session's cost, then against `Partner.maxBonusPaymentPercent` (already a
generic, per-partner field — not QR-specific, so EV charging did not need its
own copy), then reserved and settled through the same
`BonusEngineService.reserve`/`settleReservation` calls `EvSessionsService
.stopOnce` uses. `roaming-cpo-settlement.int-spec.ts`'s "bonus-partial-payment"
block proves the split (5,000 of 10,000 AMD from bonus, the rest — settled
outside TuTak by the partner's own payment flow, per requirement 2 — reflected
only in `Transaction.amount`, not in anything TuTak moves), the
cost ceiling, and the `maxBonusPaymentPercent` ceiling.

---

## Mobile / admin / partner UI

**Mobile** (`apps/mobile/src/presentation/screens/partners/PartnersScreen.tsx`):
`StationCard` now branches on `station.provider`. A `ROAMING_CPO` station
renders `RoamingCpoStationFooter` — a single "Open roaming-CPO app" button
(`openRoamingCpoApp`, `apps/mobile/src/presentation/utils/
roamingCpoDeepLink.ts`) instead of the tappable per-connector Start strip.
Every non-roaming-CPO station is completely unchanged — same component, same
props, same Start behaviour. `PartnersScreen.test.tsx`'s new "the partner
stations never show Start/Stop" block is the regression net: one test proves
the roaming-CPO footer replaces Start and `evApi.startSession` is never called
for it; the other proves an `INTERNAL` station still shows the ordinary
tappable Start target and calls `startSession` exactly as before.
`EvSessionScreen` (the in-progress-session/Stop screen) needed no change: a
roaming-CPO session is created directly as `COMPLETED` by the settlement
webhook, so it never appears as an active `CHARGING` session a customer could
attempt to stop from TuTak — the constraint holds structurally, not by an
added guard. Completed roaming-CPO sessions show up in the customer's existing
transaction history / wallet screens automatically (same `EV_CHARGING`
`Transaction` type, same wallet posting shape) — no new screen was built, per
Arman's "minimal" UX confirmation.

**Admin** (`apps/admin/src/app/(dashboard)/roaming-cpo-stations/page.tsx`, new
sidebar entry): a partner picker plus a table of that partner's the partner
stations — external id, standard retail rate (inline-editable), connector
count. Editing calls the same `PATCH /roaming-cpo/stations/:id/tariff` route
the partner dashboard would use; both are immutability-safe by construction
(see above).

**Partner** (`apps/partner/src/app/(dashboard)/ev-stations/page.tsx`,
existing page extended, not duplicated): a `Roaming partner` badge and the
station's standard retail rate now show alongside every `ROAMING_CPO`-provider
station, with a note that individual sessions settle at each customer's own
partner-set tariff, not this display rate. Non-roaming-CPO stations render
exactly as before.

---

## Test / typecheck / lint results

All run with the official commands only (`npx jest` — never
`--selectProjects`, per the brief's explicit instruction and the earlier
history it references).

### `apps/api`

- `npx tsc --noEmit -p tsconfig.build.json` — clean, 0 errors.
- `npx tsc --noEmit -p tsconfig.spec.json` — clean, 0 errors.
- `npx eslint .` — clean, 0 problems.
- `npx prisma migrate status` — `Database schema is up to date!` (42
  migrations, including this pass's `20260825143028_roaming_cpo_integration`).
- `npx jest` — **85 test suites passed (85 total), 1227 tests passed (1227
  total)**, 0 failures. Run clean, in isolation (a stray leftover process from
  an earlier concurrent run had been killed first, and Postgres/Redis
  connection counts confirmed clean before this run started) — see this
  pass's own verification log for the full run. The pre-existing baseline
  this pass started from was 83 suites / 1199 tests; this pass adds exactly 2
  suites (`roaming-cpo-settlement.service.spec.ts`,
  `roaming-cpo-settlement.int-spec.ts`) and 28 tests net (8 pure-arithmetic +
  20 integration), with zero tests removed or modified anywhere else.

New suites added: `src/modules/roaming-cpo/roaming-cpo-settlement.service.spec.ts`
(8 tests, pure margin/cap-boundary arithmetic) and
`test/roaming-cpo-settlement.int-spec.ts` (19 tests: worked examples + ledger
postings, idempotency ×3, immutable snapshots, customer linking ×3,
bonus-partial-payment ×3, multi-station independence ×2, station sync,
M2M auth). `test/ev-charging.int-spec.ts` (the pre-existing internal-EV
suite, 18 tests) passes unmodified — the regression proof that nothing about
the existing program changed.

### `apps/admin`

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx jest` — 5 suites, 34 tests, all passing.

### `apps/partner`

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx jest` — 4 suites, 26 tests, all passing.

### `apps/mobile`

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx jest` — 29 suites, 236 tests, all passing (includes the new
  roaming-CPO Start/Stop regression tests in `PartnersScreen.test.tsx`).

### `packages/shared-types`, `packages/i18n`

- `npx tsc --noEmit` — clean in both.

### `demo/`

`scripts/build-demo-app.sh` was re-run after the mobile/shared-types/i18n
changes. The resulting diff touches exactly the files this pass changed and
nothing else: `demo/src/data/api/mockData.ts`,
`demo/src/presentation/screens/partners/PartnersScreen.tsx`,
`demo/src/presentation/utils/roamingCpoDeepLink.ts` (new),
`demo/vendor/i18n/locales/{en,ru,hy}.json`,
`demo/vendor/shared-types/dto/ev.ts`, `demo/vendor/shared-types/enums/ev.ts`
— confirming zero drift.

---

## Deliberately left out of scope, and why

- **A real webhook signature scheme** (HMAC over the body, timestamp/nonce
  replay protection) for the two inbound M2M routes. The `x-api-key` header
  check is real and load-bearing, but without the partner's actual documented
  contract there is no real signature scheme to implement — inventing one now
  risks it needing to be redone once the partner's real requirements are
  known, which is exactly the trap requirement 4 warns against. `x-api-key`
  is a legitimate, if simpler, M2M mechanism on its own and is what ships.
- **A real TuTak↔partner wholesale-cost settlement/reconciliation
  process.** This integration correctly *books* TuTak's margin in the
  existing ledger (see "Ledger accounting"), but does not model the actual
  periodic cash settlement of the wholesale amount TuTak owes the partner —
  that is a real commercial process (most likely modelled later as a
  `PartnerCollection`/`Payout`-shaped flow once the partner's actual billing
  cadence is known) outside this pass's scope.
- **Partner self-service API-key issuance.** Requirement 3 explicitly frames
  the M2M credential as TuTak-provisioned, not partner-self-served, so
  issuance is platform-admin-only; a partner can list (masked) and revoke
  their own keys but cannot mint a new one without TuTak's team. Worth
  reconsidering if the partner's own onboarding flow ends up wanting
  self-service.
- **`FraudDetectionService.checkVelocity`** is not called from the roaming-CPO
  settlement path. That check exists specifically to catch a client
  self-reporting an implausible meter value (`EvSessionsService
  .assertDeliverable`'s whole reason for existing); a roaming-CPO session's
  energy/tariff/amount are the partner's own authoritative report, not a
  customer-controlled input, so the same fraud surface does not exist here in
  the same shape. Worth adding if roaming-CPO sessions turn out to need their
  own velocity-abuse detection later.
- **Reconciliation against a roaming-CPO-reported CDR correction.** Internal
  roaming sessions get `EvCdrReconciliationService`'s PENDING → MATCHED /
  CORRECTED / UNDERBILLED lifecycle because a roaming CPO's settled CDR
  arrives *after* the session and may disagree with what was billed.
  the partner's settlement webhook *is* the final, authoritative report
  already (there is nothing further to reconcile it against), so every
  the roaming-CPO `EvCdr` row is stamped `NOT_APPLICABLE` — same meaning as an
  internal TuTak-owned station's own meter.

---

## File list

**API (new):**
`apps/api/prisma/migrations/20260825143028_roaming_cpo_integration/migration.sql`,
`apps/api/src/modules/roaming-cpo/roaming-cpo-provider.interface.ts`,
`apps/api/src/modules/roaming-cpo/noop-roaming-cpo-provider.service.ts`,
`apps/api/src/modules/roaming-cpo/partner-api-key.service.ts`,
`apps/api/src/modules/roaming-cpo/roaming-cpo-api-key.guard.ts`,
`apps/api/src/modules/roaming-cpo/decorators/roaming-cpo-partner.decorator.ts`,
`apps/api/src/modules/roaming-cpo/dto/roaming-cpo-station-sync.dto.ts`,
`apps/api/src/modules/roaming-cpo/dto/roaming-cpo-session-settle.dto.ts`,
`apps/api/src/modules/roaming-cpo/dto/link-roaming-cpo-customer.dto.ts`,
`apps/api/src/modules/roaming-cpo/dto/partner-api-key.dto.ts`,
`apps/api/src/modules/roaming-cpo/dto/update-station-tariff.dto.ts`,
`apps/api/src/modules/roaming-cpo/roaming-cpo-stations.service.ts`,
`apps/api/src/modules/roaming-cpo/roaming-cpo-customers.service.ts`,
`apps/api/src/modules/roaming-cpo/roaming-cpo-settlement.service.ts`,
`apps/api/src/modules/roaming-cpo/roaming-cpo-settlement.service.spec.ts`,
`apps/api/src/modules/roaming-cpo/roaming-cpo.controller.ts`,
`apps/api/src/modules/roaming-cpo/roaming-cpo.module.ts`,
`apps/api/test/roaming-cpo-settlement.int-spec.ts`.

**API (edited):** `apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`,
`apps/api/test/setup/harness.ts`, `apps/api/test/setup/fixtures.ts`.

**Shared types:** `packages/shared-types/src/enums/ev.ts`,
`packages/shared-types/src/dto/ev.ts`.

**i18n:** `packages/i18n/src/locales/{en,ru,hy}.json` (four new `ev.*` keys).

**Mobile (new):** `apps/mobile/src/presentation/utils/roamingCpoDeepLink.ts`.
**Mobile (edited):**
`apps/mobile/src/presentation/screens/partners/PartnersScreen.tsx`,
`apps/mobile/src/presentation/screens/partners/PartnersScreen.test.tsx`,
`apps/mobile/src/data/api/mockData.ts`.

**Admin (new):**
`apps/admin/src/app/(dashboard)/roaming-cpo-stations/page.tsx`,
`apps/admin/src/lib/api/fastChargeApi.ts`.
**Admin (edited):** `apps/admin/src/components/Sidebar.tsx`.

**Partner (edited):**
`apps/partner/src/app/(dashboard)/ev-stations/page.tsx`.
