# Route-parameter UUID validation — resolves PENTEST_2026-08-23.md §B.2

**Date:** 2026-08-23.
**Branch:** `claude/tutak-loyalty-mvp-e485jm`.
**Resolves:** `docs/PENTEST_2026-08-23.md` §B.2, LOW, deferred there as its own
dedicated pass rather than fixed inline during that day's media/map sweep.
This is that pass.

---

## The finding, in one paragraph

No `:id`-shaped route parameter anywhere in `apps/api` was validated as a
UUID before reaching Prisma. Every primary key in `prisma/schema.prisma` is
`String @id @default(uuid())`, which Postgres stores as plain `text`, not the
native `uuid` type — so the database enforces no shape on it at all. A value
that simply does not match a row 404s harmlessly; a value containing a byte
Postgres's `UTF8` encoding itself rejects — a null byte, most reliably —
reached `findUnique` and failed inside the query, which the global
`AllExceptionsFilter` turned into a generic, incident-logged `500` for what
was really an ordinary malformed request. Safely contained (no crash, no
leaked internals), but wrong, and noisy: every occurrence polluted
incident/error monitoring with input that was never exceptional.

## The fix

A small decorator, `apps/api/src/common/decorators/uuid-param.decorator.ts`:

```ts
export const UuidParam = (property: string) => Param(property, ParseUUIDPipe);
```

`ParseUUIDPipe` is Nest's own built-in pipe — nothing custom was invented.
`@UuidParam('id')` replaces `@Param('id')` wherever the parameter is a UUID
primary/foreign-key lookup, rejecting a malformed value with a
`BadRequestException` before it ever reaches a service or Prisma. That
exception's default body — `{statusCode, message, error: 'Bad Request'}` — is
the same shape `ValidationPipe` already produces for a failed DTO field
(confirmed by reading `HttpException.createBody` and by a live request,
below), so `AllExceptionsFilter` renders it identically: `code: "Bad
Request"`, no `incidentId` (that field is only ever attached to a real
`5xx`). This is not a new error shape — it is the existing one, applied one
layer earlier.

A route keyed by something other than a UUID primary/foreign key was left on
plain `@Param()`. See "What was deliberately left unvalidated" below.

## Scope of the sweep

Every controller under `apps/api/src/modules` was read individually — not a
find-and-replace. `grep -rn "@Param(" apps/api/src/modules` found every
route-parameter use; each was checked against `prisma/schema.prisma` to
confirm what it actually looks up before deciding whether `UuidParam`
applied.

**13 controllers touched, 41 parameter call sites converted:**

| Controller | Routes | Parameter → model |
| --- | --- | --- |
| `admin/admin.controller.ts` | `PATCH /admin/users/:id/active` | `id` → `User.id` |
| `analytics/analytics.controller.ts` | `GET /analytics/partners/:partnerId` | `partnerId` → `Partner.id` |
| `ev-charging/ev-charging.controller.ts` | `GET /ev/stations/:id`, `POST /ev/reservations/:id/cancel`, `POST /ev/sessions/:id/meter-value`, `POST /ev/sessions/:id/stop` | `id` → `EvStation.id` / `EvReservation.id` / `EvSession.id` |
| `media/media-delivery.controller.ts` | `GET /media/brand/:assetId/:variant`, `GET /media/private/:assetId/:variant` | `assetId` → `MediaAsset.id` |
| `media/partner-media.controller.ts` | `GET .../media`, `PUT .../logo`, `PUT .../cover`, `POST .../media/:assetId/approve`, `DELETE .../logo`, `DELETE .../cover` (all under `partners/:partnerId`) | `partnerId` → `Partner.id`, `assetId` → `MediaAsset.id` |
| `notifications/notifications.controller.ts` | `POST /notifications/:id/read` | `id` → `Notification.id` |
| `partners/partner-integrations.controller.ts` | `GET`/`POST` under `partners/:partnerId/integrations`, `POST .../:integrationId/verify-website` | `partnerId` → `Partner.id`, `integrationId` → `PartnerIntegration.id` |
| `partners/partners.controller.ts` | `GET /partners/:id`, `.../transactions`, `POST .../approve`, `.../reject`, `PATCH .../commercial-settings`, `.../active` | `id` → `Partner.id` |
| `payments/payments.controller.ts` | `GET /payments/:id`, `.../refunds` | `id` → `Payment.id` |
| `payouts/payouts.controller.ts` | `GET /payouts/partners/:partnerId(/balance\|/settlements)`, `POST /payouts/:id/(confirm\|fail)` | `partnerId` → `Partner.id`, `id` → `Payout.id` |
| `purchase-intents/purchase-intents.controller.ts` | `GET /purchase-intents/:id`, `.../refunds`, `POST .../confirm`, `.../reject`, `.../refund` | `id` → `PurchaseIntent.id` |
| `reconciliation/reconciliation.controller.ts` | `GET /admin/ledger/accounts/:id/postings`, `POST /admin/partners/:partnerId/payout-block/clear` | `id` → `LedgerAccount.id`, `partnerId` → `Partner.id` |
| `security/security.controller.ts` | `POST /admin/fraud-signals/:id/resolve` | `id` → `FraudSignal.id` |

No other controller in `apps/api/src/modules` takes a route parameter at
all — `auth`, `users`, `wallet`, `transactions`, `referral`,
`qr-payments`, `refunds`, `audit`, `health`, `metrics`, and the media
upload/consent routes on `users/me` and `admin/media` only ever act on the
caller's own identity or take input through the body, already covered by
the global `ValidationPipe`.

## What was deliberately left unvalidated, and why

- **`media-delivery.controller.ts`'s `:variant` parameter.** Not a database
  key of any kind — it is one of `display`/`thumb`/`original`, and the
  controller already rejects anything else itself
  (`parseVariant()` → `NotFoundException` for `original` or anything
  unrecognized). Wrapping it in `UuidParam` would reject every legitimate
  request.
- **`SweepRun.name` (`prisma/schema.prisma`'s one non-UUID primary key,**
  `name String @id`, a config/lookup table). No controller anywhere takes a
  route parameter for it — it is read only by `SweepsProcessor` and
  `MetricsService`, never off a request path — so there is no route to
  either fix or accidentally break here. Flagged explicitly so the absence
  reads as "checked, not present" rather than "not checked."

No other schema model deviates from `String @id @default(uuid())`, and no
other route parameter in the codebase maps to anything but a UUID
primary/foreign key — confirmed by reading every controller with a `:param`
in its path, not by assuming the schema grep was exhaustive on its own.

## A minor, strictly-positive side effect

`media-delivery.controller.ts`'s `/private/:assetId/:variant` route
previously ran an HMAC signature check (`verifySignature`) before ever
touching Prisma, so a malformed `assetId` there produced `403 "invalid or
expired"` rather than the `500` the public `/brand` route produced. With
`UuidParam`, a malformed `assetId` on `/private` now short-circuits to `400`
*before* signature verification runs, same as everywhere else. This is a
more accurate status (the shape is wrong, not the signature) and not a
capability regression — the two independent checks the route's own docblock
describes (signature validity, then live re-authorization) are unchanged for
every well-formed request.

## Verification

### Before the fix (live, against the running server)

```
$ curl -s "http://127.0.0.1:4000/v1/media/brand/null%00/display"
{"statusCode":500,"code":"INTERNAL_ERROR","message":"Internal server error",
 "path":"/v1/media/brand/null%00/display","timestamp":"...",
 "incidentId":"b47302d3-01a6-41ba-84a4-e8e9a9877622"}
```

Server log for that request:

```
PrismaClientUnknownRequestError:
Invalid `this.prisma.mediaAsset.findUnique()` invocation ...
PostgresError { code: "22021", message: "invalid byte sequence for
  encoding \"UTF8\": 0x00", ... }
[ExceptionFilter] [b47302d3-...] GET /v1/media/brand/null%00/display -> 500
```

Same request shape against an authenticated route, before the fix:

```
$ curl -s "http://127.0.0.1:4000/v1/partners/null%00" -H "Authorization: Bearer <token>"
{"statusCode":500,"code":"INTERNAL_ERROR", ...}

$ curl -s "http://127.0.0.1:4000/v1/ev/stations/not-a-uuid" -H "Authorization: Bearer <token>"
{"statusCode":404,"code":"Not Found","message":"Charging station not found", ...}
```

(A non-null-byte malformed string like `not-a-uuid` never 500'd — it simply
matched no row, since the column is `text` — but it is still the wrong
failure class for a client-side shape error, and the task's own framing
treats it as in scope. Both cases become a clean `400` below.)

### After the fix (rebuilt, restarted, live)

```
$ curl -s "http://127.0.0.1:4000/v1/media/brand/null%00/display"
{"statusCode":400,"code":"Bad Request","message":"Validation failed (uuid is expected)", ...}

$ curl -s "http://127.0.0.1:4000/v1/media/brand/not-a-uuid/display"
{"statusCode":400,"code":"Bad Request","message":"Validation failed (uuid is expected)", ...}

$ curl -s "http://127.0.0.1:4000/v1/media/brand/$(python3 -c "print('a'*5000)")/display"
{"statusCode":400,"code":"Bad Request","message":"Validation failed (uuid is expected)", ...}

$ curl -s "http://127.0.0.1:4000/v1/partners/null%00" -H "Authorization: Bearer <token>"
{"statusCode":400,"code":"Bad Request","message":"Validation failed (uuid is expected)", ...}

$ curl -s "http://127.0.0.1:4000/v1/ev/stations/not-a-uuid" -H "Authorization: Bearer <token>"
{"statusCode":400,"code":"Bad Request","message":"Validation failed (uuid is expected)", ...}

$ curl -s "http://127.0.0.1:4000/v1/purchase-intents/not-a-uuid" -H "Authorization: Bearer <token>"
{"statusCode":400,"code":"Bad Request","message":"Validation failed (uuid is expected)", ...}
```

Same shape as an ordinary DTO validation failure from the same running app
(`POST /v1/auth/register/verify-otp` with a missing field):

```
{"statusCode":400,"code":"Bad Request","message":["deviceId must be a string"], ...}
```

— identical `statusCode`/`code` fields; `message` is a string instead of an
array only because `ParseUUIDPipe` reports one violation instead of many,
exactly like `ValidationPipe` does for a single-field DTO failure.

**Shape passes but existence still fails correctly** (proving the fix checks
shape, not existence):

```
$ curl -s "http://127.0.0.1:4000/v1/ev/stations/11111111-1111-4111-8111-111111111111" \
  -H "Authorization: Bearer <token>"
{"statusCode":404,"code":"Not Found","message":"Charging station not found", ...}
```

**A legitimate, real UUID still works exactly as before:**

```
$ curl -s "http://127.0.0.1:4000/v1/ev/stations/aadc68c8-d767-4c4c-86ce-ef765903dc2b" \
  -H "Authorization: Bearer <token>"
{"data":{"id":"aadc68c8-...","name":"Republic Square", ... },"timestamp":"..."}

$ curl -s "http://127.0.0.1:4000/v1/partners/4fe9cab5-5e69-4f68-bcdb-e9a5a69291aa" \
  -H "Authorization: Bearer <token>"
{"data":{"id":"4fe9cab5-...","displayName":"Jazzve Coffee", ... },"timestamp":"..."}
```

**Guard ordering is unaffected.** A malformed id on a permission-gated route,
called by a caller who does not hold the permission, still returns that
route's own `403` — guards run before pipes in Nest's request pipeline, so
the pipe is never reached and no new information is disclosed to an
unauthorized caller:

```
$ curl -s -X POST "http://127.0.0.1:4000/v1/admin/fraud-signals/not-a-uuid/resolve" \
  -H "Authorization: Bearer <customer-token-without-ADMIN_AUDIT_READ>"
{"statusCode":403,"code":"Forbidden","message":"Insufficient permissions to access this resource", ...}
```

Both throwaway accounts used above were registered through the real OTP
flow — `+37444099001` ("IdUuid Pentest", customer) and a login as the seeded
super-admin (`+37400000000`, no password reset, no state change beyond
login) — matching this repo's established convention.

### Automated regression tests

`apps/api/test/id-validation.int-spec.ts`, 15 tests, all passing. This is the
one file in the suite that boots a real listening Nest HTTP server —
`createHttpTestHarness()`, added to `test/setup/harness.ts` alongside the
existing `createTestHarness()` (which every other suite uses, and which
explicitly does *not* start an HTTP adapter). The reason is the same one
`docs/PENTEST_2026-08-23.md` §B.1 already documented for `ThrottlerGuard`:
`ParseUUIDPipe` is part of Nest's request-argument pipeline, which does not
run when a controller method is simply called as a plain TypeScript
function — the way every other suite in this repo exercises the app. Unlike
`@Throttle`, `ParseUUIDPipe` has no inspectable metadata to pin via
`Reflect.getMetadata`, so a real (if narrowly scoped) HTTP server is what
actually proves the behavior here; the harness mirrors `main.ts`'s
`ValidationPipe`/versioning and `AppModule`'s `AllExceptionsFilter`/
`TransformInterceptor`, but not its guards (`JwtAuthGuard` etc. are
`AppModule`-level `APP_GUARD` providers neither harness imports) — which is
fine, since a pipe rejects a malformed argument during resolution, before
the handler or anything the guards would have gated ever runs. See both
files' docblocks for the full reasoning.

The suite covers four routes spanning four different modules and three
different parameter names (`assetId`, `id`, `partnerId`):
`GET /v1/media/brand/:assetId/:variant`, `GET /v1/partners/:id`,
`GET /v1/ev/stations/:id`, `POST /v1/admin/partners/:partnerId/payout-block/clear`
— each rejecting a non-UUID string, a null byte, and a 3,000-character
garbage string with a clean `400`. Plus: the malformed-id body matches a
real DTO validation failure's shape field-for-field; a well-formed but
non-existent UUID is a `404` not a `400`; and a real, freshly-created
`EvStation` still resolves normally end to end.

### Full suite, typecheck, lint

| Command | Result |
| --- | --- |
| `npx jest --selectProjects integration --testPathPattern id-validation --testTimeout=30000` | PASS — 15/15 (new) |
| `npx jest --selectProjects integration unit --testTimeout=30000` (full `apps/api` suite) | PASS — see below |
| `npm run typecheck` (this package) | PASS |
| `npx eslint <every file changed>` | PASS — 0 problems |
| `cd /home/user/TuTak-Platform && pnpm typecheck` (whole monorepo) | PASS |
| `npx eslint apps packages tools` (whole monorepo) | PASS |

## What needs a human decision

Nothing new. This closes the one item `docs/PENTEST_2026-08-23.md` §D left
outstanding.

## Files changed

- `apps/api/src/common/decorators/uuid-param.decorator.ts` — new.
- 13 controllers (listed in the table above) — `@Param(...)` →
  `@UuidParam(...)` at the 41 call sites that look up a UUID primary/foreign
  key; unused `Param` imports dropped where nothing else in the file still
  used it.
- `apps/api/test/setup/harness.ts` — added `createHttpTestHarness()` and
  `HttpTestHarness`, extracted the shared module list into
  `domainTestingModuleBuilder()` so it cannot drift from
  `createTestHarness()`'s.
- `apps/api/test/id-validation.int-spec.ts` — new, 15 regression tests.

No financial logic, authorization rule, or DTO's business meaning was
touched — every change here is input-shape validation added in front of an
existing, unchanged lookup.
