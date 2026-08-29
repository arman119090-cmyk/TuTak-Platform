# Roaming-CPO security, migration and customer-charging hardening

Forward-referenced from `docs/ROAMING_CPO_INTEGRATION_2026-08-25.md`'s
"Migration-history note, 2026-08-29." This document covers the three
problems in the 2026-08-29 hardening task and records exactly what shipped
against them, and — just as importantly — what did not.

## The final business model (authoritative)

TuTak is the customer-facing charging app. A customer discovers, starts,
monitors and stops a charging session entirely through the TuTak app —
never a roaming-CPO partner's own app or account. TuTak buys electricity
from a CPO at a contractual wholesale rate (`Partner.evWholesaleRatePerKwh`)
and resells it at its own retail rate per station
(`EvStation.standardRetailRatePerKwh`), both frozen independently at the
moment a session starts. A customer must never be required to link or use
an external CPO account; the TuTak User ID is the only identity that
matters. The CPO provides authenticated remote Start/Stop and trusted
meter/CDR data over a documented server-to-server API (OCPI, in this
codebase's existing `OcpiAdapter` shape) — never a customer-supplied
reading.

No brand name is hardcoded anywhere in this integration, on either the old
or the new business model — see the earlier document's own note on that.

## Problem 1 — the broken migration (fixed and verified)

`20260827000000_reinstate_roaming_cpo` re-declared columns, tables and
indexes that `20260825143028_fastcharge_integration` already created on a
fresh database, because it was written on the mistaken assumption that a
prior removal migration had already stripped them. Consolidated into one
migration, `20260825143028_roaming_cpo_integration` — see the earlier
document's migration-history note for the full repository-evidence
justification for why this was safe to do (no environment in this
repository has ever run `prisma migrate deploy` against anything but a
disposable, freshly-created database).

Verified: a fresh-database `migrate deploy` (all 46 migrations, no
collision); an upgrade simulated from the last known-good pre-EV/roaming
checkpoint (commit `59a8b12`, i.e. deploying only through
`20260824120000_partner_collection_dual_control_and_bank_txn_id`) followed
by deploying the rest of history including the new migration — byte-identical
resulting schema to the fresh path (confirmed via `pg_dump --schema-only`
diff, ignoring the `\restrict`/`\unrestrict` tokens `pg_dump` randomizes
per run); `prisma migrate status` drift check clean on both; `prisma
generate`; full `tsc` build+spec typecheck; `nest build`; a live boot with
`/health/ready` reporting `database: ok, redis: ok` against the freshly
migrated, freshly seeded schema.

## Problem 2 — fake charging sessions (capability model and financial accounting both shipped)

### What was actually wrong

The existing `roaming-cpo` module (`RoamingCpoStationsService.sync`,
`RoamingCpoSettlementService.settle`) is a **partner-push, walk-in-at-the-
CPO** design: the customer pays the CPO directly at their own terminal, and
the CPO calls TuTak afterward with a settled session report. That is the
opposite of the final model above, and it does not disappear — it stays as
a legitimate path for a genuinely walk-in, non-app session a partner wants
to report for revenue-share purposes. What made it dangerous is that
`RoamingCpoStationsService.sync` never populated `EvConnector.ocpiEvseUid`,
so a `ROAMING_CPO`-provider connector fell straight through
`EvSessionsService.start()`'s ordinary local-claim path — the exact same
path an internal, TuTak-owned charger uses — with **no remote command ever
sent to any real CPO**. `GET /ev/stations` had no permission guard at all,
so any authenticated customer could enumerate that inventory (including
hidden roaming stations) and feed a connector id straight into
`sessions/start`.

The codebase already had the right shape sitting unused for the honest
path: `OcpiAdapter` (`startRemoteSession`/`stopRemoteSession`/`fetchCdr`,
keyed off `ocpiEvseUid`) is already wired into `start()`/`stopOnce()`, and
its `NoopOcpiAdapter` already does the right thing when unconfigured —
`{ accepted: false }`, never a simulated success. The fix reuses that
rather than inventing a parallel mechanism.

### What shipped

- `EvStation` gained four explicit, persisted capability columns
  (migration `20260828000000_ev_station_capability_and_link_quarantine`):
  `customerChargingEnabled`, `remoteStartSupported`, `remoteStopSupported`,
  `trustedTelemetrySupported`. Every `INTERNAL` station (existing, and any
  created going forward via `EvStationsService.createStation`) is `true` on
  all four — TuTak's own hardware has always had these properties trivially.
  Every `ROAMING_CPO` station starts `false` and must be turned on
  deliberately, per station, once its adapter path is proven.
- `EvStationsService.listNearby` now filters on `customerChargingEnabled`
  instead of a hardcoded `provider === INTERNAL` — a roaming station becomes
  discoverable the moment it is genuinely chargeable, not permanently
  excluded by brand.
- `GET /ev/stations` now requires `EV_STATION_MANAGE` and is scoped by
  `assertPartnerScope`/`resolveOperatorPartner` like every other management
  route — a partner sees their own network, a platform admin sees
  everything, an ordinary customer gets `403`. The customer-facing single-
  station lookup (`GET /ev/stations/:id`) is a separate method,
  `findChargeableStationOrThrow`, which 404s a station that exists but
  isn't `customerChargingEnabled` — deliberately indistinguishable from a
  station that doesn't exist, so the fix doesn't just trade an IDOR for an
  existence oracle.
- `EvSessionsService.start()` refuses outright unless
  `connector.station.customerChargingEnabled` is true, and — for a
  `ROAMING_CPO` station specifically — additionally requires
  `remoteStartSupported`, `remoteStopSupported` and a non-null
  `ocpiEvseUid` before it will even attempt the existing OCPI call. This is
  defense in depth on top of (never instead of) the adapter's own real-time
  accept/reject: a station flipped to `customerChargingEnabled` without its
  connector actually wired still fails closed instead of silently claiming
  the bay.
- `EvSessionsService.reportMeterValue()` now refuses any reading — customer
  or operator — for a session on a `ROAMING_CPO` station. Nothing bills a
  CPO session from a number that arrived over this endpoint; the CPO's own
  trusted CDR is the only legitimate source, exactly as the final model
  requires.

### What did not ship on 2026-08-27 (and shipped 2026-08-29 instead)

As originally written, this section said freezing the dual rate at Start,
billing from a trusted CDR at Stop, and the saga around remote Stop were
not implemented, and that `stopOnce()` failed closed for every
`ROAMING_CPO` session rather than complete one incorrectly. That is no
longer the case — see
`docs/ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md` for the full design
and what actually shipped: `start()` now freezes the dual rate, `stop()`
parks the session at a new `AWAITING_SETTLEMENT` status instead of failing
closed, and the existing `EvCdrReconciliationService` sweep completes and
bills it the first time the CPO's own trusted CDR arrives — exactly the
"extend the existing async true-up loop" approach this section originally
proposed as the remaining work.

One piece named here is still deliberately unbuilt: a real money-collection
mechanism for what the customer now owes. The 2026-08-29 pass completes the
*accounting* (frozen rates, margin split, referral crediting, a balanced
ledger) but bills through the same "record a `Transaction`, no real payment
capture" pattern every other purchase path in this codebase already uses —
it does not invent a prepaid wallet top-up or wire in card capture. See
that document's own `EV_ROAMING_RECEIVABLE` account section for exactly
what this means and does not mean.

## Problem 3 — insecure external linking (fixed)

`POST /roaming-cpo/customers/link` let a logged-in customer bind an
arbitrary self-entered `externalCustomerId` immediately, with no proof it
was ever theirs. Removed entirely from `RoamingCpoController` — there is no
customer-facing route left that reaches `RoamingCpoCustomersService.link`
with attacker-controlled input. That method still exists for a trusted
server-to-server handshake to call, and every link it creates is now
stamped `verifiedAt` at creation.

`RoamingCustomerLink` gained a nullable `verifiedAt` column (same
migration as Problem 2's capability columns). Every link that existed
before this change — all of them created by the removed customer-entered
flow — was migrated with `verifiedAt = null`: quarantined, not reassigned,
not deleted, not silently promoted. `RoamingCpoSettlementService.settleOnce`
now refuses to settle against any link whose `verifiedAt` is null.

## Tests

`test/ev-roaming-capability.int-spec.ts` (new): fake-session prevention on
an unconfigured `ROAMING_CPO` connector, on one with capability flags but
no `ocpiEvseUid`, and — against the actual `NoopOcpiAdapter` the test
harness wires by default — on one with every flag and `ocpiEvseUid` set,
confirming the "missing/No-op adapter must reject, never simulate success"
invariant end to end rather than by inspecting the adapter class in
isolation; meter-value rejection for both a customer and an operator caller
on a roaming session; the fail-closed stop; unverified-link settlement
rejection; settlement against a link created through the trusted service
path.

`test/ev-stations-nearby.int-spec.ts` (rewritten): discovery excludes a
non-chargeable roaming station and includes one once enabled; the
customer-facing single-station lookup 404s a non-chargeable station; the
hidden-inventory IDOR fix — a platform admin sees every partner's stations,
a partner-scoped staff member sees only their own, and naming a different
partner explicitly is refused.

`roaming-cpo-settlement.int-spec.ts`'s existing linking/settlement tests
were left otherwise unchanged; `linkRoamingCpoCustomer` (the test fixture,
not the removed endpoint) now defaults to `verified: true` since it stands
in for a trusted server-to-server-created mapping, with `verified: false`
available for the new quarantine tests.
