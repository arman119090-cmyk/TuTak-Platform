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
  wallet, referral, qr-payments, ev-charging, partners, admin, transactions,
  notifications, analytics, security/fraud, audit — each own their
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
roaming CPO integration (FastCharge or otherwise) would implement; a
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
(available/pending/reserved) — see `packages/i18n` for copy and
`apps/mobile/src/app/theme/colors.ts` / the Tailwind `@theme` blocks in
`apps/admin` and `apps/partner` for the token source of truth. The mascot
(Jako, an African Grey Parrot) currently ships as a minimal vector
placeholder (`MascotBadge`) pending final illustrated artwork from brand —
swap the SVG, keep the `size` prop contract.

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
   credentials exist.
6. **Final brand assets.** The mascot is a placeholder SVG.

### Engineering, in rough priority order

1. **Horizontal scale.** Recurring work is on BullMQ (`SweepsModule`), so
   the schedule is one row in Redis rather than a timer per instance and
   adding instances adds drain capacity. What remains is the database side:
   `connection_limit` is unset, so Prisma opens `num_cpus × 2 + 1` per
   instance, and read replicas for analytics and history are untouched. See
   `docs/LOAD_TEST.md` for where the ceiling actually sits.
2. **Tracing and alerting.** Structured JSON logging with request
   correlation is in place; OpenTelemetry spans, error tracking and metrics
   are not.
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
was the last open end — and a CI pipeline that lints, typechecks, runs 72
unit and 357 integration tests, builds every app, builds all three
container images, boots the whole stack and drives the dashboards through
twelve end-to-end scenarios in a browser.

None of the above are architectural dead-ends — they are additive on top of
the module boundaries already in place.
