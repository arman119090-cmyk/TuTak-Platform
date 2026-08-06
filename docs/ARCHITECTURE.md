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

Built as real, working code end-to-end (not stubs) — but "serves millions of
users" is a destination, not a day-one state. Honest list of what a scale-up
still needs, roughly in priority order:

1. **Web auth hardening.** Admin/partner dashboards currently hold JWTs in
   localStorage via zustand for MVP simplicity. Move to httpOnly, SameSite
   cookies issued by a thin BFF layer before handling real money in
   production — this closes the XSS-token-theft surface localStorage has.
2. **OCPI/FastCharge integration.** The adapter interface and data model are
   ready; `NoopOcpiAdapter` needs to become a real OCPI 2.2.1 client once
   credentials with a roaming partner exist.
3. **Geo queries.** `EvStationsService.listNearby` does bounding-box math in
   application code; swap for PostGIS (`ST_DWithin`) once station count
   makes that necessary.
4. **Horizontal scale.** Add Postgres read replicas for analytics/history
   reads, a queue (BullMQ, already have Redis) for notification delivery and
   the bonus-lot promotion/expiry crons instead of in-process `@nestjs/schedule`
   once running more than one API instance, and CDN/edge caching for the
   dashboards.
5. **Observability.** Structured logging is in place (Nest's `Logger`); add
   OpenTelemetry tracing, error tracking (Sentry), and metrics/alerting
   before production traffic.
6. **Testing.** The codebase is structured for it (services are DI'd, pure
   domain logic is isolated in `BonusEngineService`), but this build did not
   include a test suite — add unit tests for the bonus engine's edge cases
   (partial lot consumption, concurrent reservations, expiry during a hold)
   and e2e tests for the QR/EV sagas before launch.
7. **CI/CD.** No pipeline exists yet — add typecheck/lint/test/build gates
   and environment-specific deploy workflows.
8. **Push notifications.** `NotificationsService` persists an in-app inbox
   row today; wire actual FCM/APNs delivery for the `PUSH` channel.
9. **Real illustrated mascot + design system.** Placeholder SVG today;
   swap in final brand assets once delivered.

None of the above are architectural dead-ends — they're additive on top of
the module boundaries already in place.
