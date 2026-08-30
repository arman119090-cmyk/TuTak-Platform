# TuTak Architecture

## Principles

- **The ledger is the source of truth.** Every bonus-point movement is an
  append-only `BonusLedgerEntry`. `Wallet.availableBonus/pendingBonus/reservedBonus`
  are a read-optimized cache over that ledger, always rewritten in the same
  DB transaction as the ledger write — never a second, independently-updated
  copy of the truth.
- **No business logic in the UI.** Mobile/admin/partner clients call the API
  and render what it returns; accrual math, reservation/settlement,
  expiration, and fraud rules all live in backend domain services.
- **Money is `Decimal`, never `Float`.** Prisma's `Decimal` type end-to-end
  for AMD amounts and bonus points.
- **Modular by domain, not by layer.** `apps/api/src/modules/*` — auth,
  wallet, referral, qr-payments, purchase-intents, ev-charging, roaming-cpo,
  customer-balance, partners, admin, transactions, notifications, analytics,
  security/fraud, audit, ledger, payments (legacy, off by default),
  settlement, payouts, reconciliation, sweeps — each own their
  controller/service/DTOs and are wired together through Nest DI and a small
  number of domain events, not by reaching into each other's internals.

## Data model

Full schema: `apps/api/prisma/schema.prisma`. The interesting parts:

### Bonus engine (event-sourced ledger + FIFO-expiring lots)

```
BonusLot                — a batch of points accrued together, PENDING → AVAILABLE
                           → EXPIRED/CONSUMED, each with its own expiresAt.
BonusReservation         — a hold against AVAILABLE lots while a QR payment or
                           EV session is in flight (prevents double-spend).
BonusReservationAllocation — join table: exactly which lots (and how much of
                           each) back a given reservation, so release/settle
                           can credit/debit the right lots.
BonusLedgerEntry         — append-only, immutable audit trail of every
                           balance-affecting event.
```

Why lots instead of a single balance integer: real loyalty programs expire
points oldest-first and need to answer "how many of my points expire this
month" — that requires tracking discrete batches, not just a running total.
Reservations exist because QR/EV redemption is a two-phase thing (reserve →
settle or release) even though today both phases happen back-to-back inside
one request — the model is ready for a genuinely asynchronous payment
provider without a schema change.

Concurrency: `reserve()` runs inside a `Serializable` Prisma transaction and
allocates FIFO from `AVAILABLE` lots with a conditional `updateMany` guard
(`remainingAmount >= allocation`) so two concurrent reservations against the
same lot can't both succeed.

### Identity / RBAC

`Role` ⇄ `Permission` (many-to-many via `RolePermission`), and `UserRole`
which optionally scopes a role to a `partnerId` (so `PARTNER_OWNER` at
Partner A is a distinct grant from `PARTNER_OWNER` at Partner B). JWT access
tokens carry a flattened claim set (`roles`, `permissions`, `partnerScopes`)
computed at login/refresh time — `RolesGuard`/`PermissionsGuard` check it
without a DB round trip per request.

### PurchaseIntent — the canonical purchase path

`docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md` established `PurchaseIntent`
as the model the spec actually asks for: the customer pays the partner
directly (cash, their own card terminal, whatever they already use) and the
app only ever records the resulting `Transaction`/bonus math — TuTak's card
processing (`PaymentsModule`) is a legacy, off-by-default path
(`CARD_PAYMENTS_ENABLED`), never the default. Same reservation → settle →
accrue → `Transaction(COMPLETED)` saga shape as QR below.

### QR payments

Three QR types map to the three real-world flows: `STATIC_MERCHANT`
(permanent, reusable — the counter QR you scan and enter an amount for),
`DYNAMIC_INVOICE` (partner generates one for a specific amount, short TTL),
`USER_PAY_TOKEN` (a customer's personal QR that a merchant scans and charges).
Redemption is a saga: create `Transaction(INITIATED)` → reserve bonus (if a
discount is applied) → settle the reservation → accrue new bonus on the paid
portion → mark `Transaction(COMPLETED)`, emitting `transaction.completed`.
Any failure after the reservation was placed releases it before marking the
transaction `FAILED`, so points never get stuck reserved.

### EV charging (OCPI-shaped)

Modeled to map cleanly onto OCPI 2.2.1's Location/EVSE/Session/CDR modules:
`EvStation` → `EvConnector` → `EvSession`/`EvReservation` → `EvCdr`. An
`OcpiAdapter` interface (`modules/ev-charging/ocpi/`) is the seam a real
roaming CPO integration would implement; a
`NoopOcpiAdapter` is wired in today and only gets called for stations that
have `ocpiEvseUid` set (i.e. roaming, not TuTak-owned). TuTak-owned stations
never touch it. Session billing reads a `meter-value` endpoint that a real
charger's OCPP telemetry would call; `stop` finalizes cost, optional bonus
redemption, bonus accrual, and a `EvCdr` row in one flow, mirroring the QR
saga above.

### Security

- JWT access tokens (short-lived) + rotating opaque refresh tokens (hashed
  at rest, rotated and revoked on every refresh, one row per device).
- argon2 password hashing, account lockout after repeated failed logins.
- RBAC + fine-grained permissions (`WalletModule`'s manual-adjust endpoint,
  `AdminModule`, `PartnersModule` writes, etc. all gate on `PermissionName`).
- Global rate limiting (`@nestjs/throttler`) plus tighter per-route limits
  on `/auth/*`.
- `AuditLog` — append-only, system-wide, written by an `AuditService` that
  every security/money-relevant action calls.
- `FraudSignal` + a rule-based `FraudDetectionService` (velocity check today)
  reviewable from the admin panel; the table is shaped so a future ML
  scoring job can write richer signals without a migration.
- API responses are explicitly mapped/`select`ed — raw Prisma `User` rows
  (which carry `passwordHash`) never leave the server boundary.

### Recurring work

Everything that runs without a request behind it lives in one place:
`SweepsModule`, backed by a BullMQ queue on the Redis that is already a
dependency. `apps/api/src/modules/sweeps/sweeps.jobs.ts` is the complete list —
outbox drain, bonus promotion, bonus expiry, expired-reservation release, EV
reservation and session cleanup, nightly reconciliation — each row carrying its
schedule, its overlap policy, and what breaks if it stops.

The module depends on the domain modules rather than the reverse, so a domain
service has no idea it is being swept and nothing in a request path can reach a
queue by accident. Two properties worth naming:

- The schedule is one row in Redis per job, not a timer per instance, so
  instances add capacity instead of duplicate ticks.
- A sweep that throws fails its job and keeps the stack trace, instead of
  logging one line and losing the tick. A sweep that has been broken for a week
  no longer looks like one that has been working for a week.

## Client apps

- **Mobile** (`apps/mobile`) — Expo/React Native, one codebase for iOS and
  Android. `app/` (theme, i18n, navigation) / `data/` (API clients, zustand
  auth store with token-refresh interceptor) / `presentation/` (screens,
  components) — a pragmatic clean-architecture split; domain logic itself
  lives server-side, so there's no separate mobile "domain" layer to speak
  of beyond typed DTOs from `@tutak/shared-types`.
- **Admin** and **Partner** (`apps/admin`, `apps/partner`) — Next.js 16 App
  Router, same auth/token-refresh pattern as mobile, Tailwind v4 for the
  minimal/Apple-inspired UI. Two separate apps (not one app with role
  branches) because their audiences, deploy cadence, and eventual hosting
  will diverge.

## Brand

Green/yellow/blue map directly to bonus states everywhere in the UI
(available/pending/reserved) — see `packages/i18n` for copy and the
`@tutak/design` token package (`packages/design/src/tokens/`) / the
Tailwind `@theme` blocks in `apps/admin` and `apps/partner` for the token
source of truth. The mascot (Jako, an African Grey Parrot) ships as the
actual logo photo (`packages/design/src/web/components/Jako.tsx`,
`logo-mark.png`) rather than illustrated vector art, per Arman's request on
2026-08-23 — the same correction applied to the mobile app's
`UserAvatar`/`PartnerMark`/`EmptyState`.

## Production-readiness roadmap

Built as real, working code end to end. What follows is what a scale-up
still needs, split by who can do it — because most of what is left is not
code.

### Blocked on a commercial decision, not on engineering

1. **An acquirer.** `SandboxPspAdapter` approves and declines on demand and
   moves no money. `PaymentsModule` refuses to boot in production with it —
   a fake acquirer that silently approved every charge would be far worse
   than a process that will not start. A real adapter is a day's work once
   there is a contract and credentials with an Armenian acquirer.
2. **An SMS carrier.** Same discipline in `SmsModule`: without
   `SMS_ENDPOINT` production refuses to start, because a verification code
   logged to stdout is indistinguishable from one that was delivered until a
   real user is locked out.
3. **A host.** `docker compose up` runs the whole platform locally and
   `docker-publish.yml` pushes an image to GHCR, but nothing owns a domain
   or a server yet.
4. **Apple and Google developer accounts.** `eas.json` has the build
   profiles; the app cannot reach a phone outside Expo Go without them.
5. **An OCPI roaming partner.** The adapter interface and data model are
   ready; `NoopOcpiAdapter` becomes a real OCPI 2.2.1 client once
   credentials exist. A separate, already-built webhook-style integration
   (`modules/roaming-cpo/`) covers a wholesale-resale partner relationship
   instead — see `docs/ROAMING_CPO_INTEGRATION_2026-08-25.md`.
6. **A real bank/PSP for customer top-ups.** The prepaid-balance mechanism
   that collects roaming-CPO charges (`modules/customer-balance/`) is fully
   built behind a `BankTopUpAdapter` seam; its `NoopBankTopUpAdapter` honestly
   refuses every top-up until a real bank (Idram or otherwise) is connected —
   see `docs/ROAMING_CPO_PREPAID_BALANCE_2026-08-29.md`.

### Engineering, in rough priority order

1. **Horizontal scale.** Recurring work is on BullMQ (`SweepsModule`), so
   the schedule is one row in Redis rather than a timer per instance and
   adding instances adds drain capacity. What remains is the database side:
   `connection_limit` is unset, so Prisma opens `num_cpus × 2 + 1` per
   instance, and read replicas for analytics and history are untouched. See
   `docs/LOAD_TEST.md` for where the ceiling actually sits.
2. **Error tracking.** Structured JSON logging with request correlation,
   OpenTelemetry distributed tracing (`common/observability/tracing.ts`),
   and a Prometheus `/metrics` endpoint are all in place; a dedicated error
   tracker (e.g. Sentry) for exception aggregation/alerting is not.
3. **Geo queries.** `EvStationsService.listNearby` does bounding-box maths
   in application code; PostGIS `ST_DWithin` once station count justifies
   it.
4. **A BFF for the dashboards.** The refresh token is already an httpOnly
   cookie the browser cannot read; the short-lived access token still sits
   in localStorage so a reload does not force a re-login. Moving it behind a
   thin server layer closes the last of that surface.

### Done since this list was first written

Kept visible because a roadmap that never shrinks stops being read: the
double-entry ledger and its reconciliation, the payment/settlement/refund/
payout engines on an idempotent outbox, structured logging with request
correlation, push notification delivery, both directions of the platform's
cash cycle — the acquirer settling `PSP_RECEIVABLE` into `PLATFORM_BANK`
was the last open end — distributed tracing joined to those logs, backup and
restore tooling proven by an actual restore, recurring work moved off
in-process cron onto a queue, a load harness that asserts the ledger still
balances under concurrency, and a CI pipeline that lints, typechecks, runs 77
unit and 368 integration tests, builds every app, builds all three
container images, boots the whole stack and drives the dashboards through
twelve end-to-end scenarios in a browser.

None of the above are architectural dead-ends — they are additive on top of
the module boundaries already in place.
