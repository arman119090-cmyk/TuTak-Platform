# Fuel-station branches, branch staff, and branch QR payments (2026-08-29)

## What this closes

Before this change, a `fuel`-category partner's `PartnerBranch` rows existed
(name/address/city, added 2026-08-26) but nothing distinguished one branch
from another operationally:

- A `PARTNER_STAFF`/`PARTNER_MANAGER` role is scoped only to a `partnerId`
  (`UserRole.partnerId`) — nothing recorded which of a partner's branches a
  given employee actually worked at. In effect, being staff at all meant
  seeing and confirming *every* branch's `PurchaseIntent` queue, history, and
  analytics.
- The only "branch QR" that existed was a plaintext, client-composed string
  (`TUTAK-PAY:<partnerId>:<branchId>`, `apps/mobile/.../partnerPayQr.ts`) —
  not backed by any database row, never verified server-side, and never
  revocable. Anyone who photographed one could reconstruct it forever.
- `Partner.sellsGas`/`sellsPetrol` (2026-08-26) are partner-wide flags for
  the customer-facing map filter ("Газ" vs "Бензин") — they say nothing
  about which *branch* of a multi-branch fuel partner sells which product.

This work adds branch-level fuel classification, branch-scoped staff
assignment (with a DB-enforced, fail-closed default), and a real,
server-issued, revocable/rotatable branch QR — and enforces branch scope at
every `PurchaseIntent` endpoint a partner's staff can reach.

## Schema (migration `20260829000000_partner_branch_fuel_and_staff`)

- `BranchFuelType` (`PETROL` / `METHANE_CNG` / `PROPANE_LPG`) on
  `PartnerBranch.fuelType` — nullable, left `NULL` on every existing branch
  rather than inferred from `sellsGas`/`sellsPetrol` (those two booleans
  cannot be mapped onto one specific branch without guessing). An
  owner/admin classifies each fuel branch explicitly after this ships
  (`PATCH /partners/:id/branches/:branchId/fuel-type`).
- `UserRole.allBranches` (default `false`) — an explicit, owner/admin-granted
  exception letting a trusted `PARTNER_MANAGER` act at every branch of a
  partner, the same reach `PARTNER_OWNER` already has unconditionally. No
  existing role is silently promoted.
- `PartnerBranchStaffAssignment` — which branch(es) a partner-scoped
  `PARTNER_STAFF`/`PARTNER_MANAGER` role may actually act at. Fields:
  `partnerId`, `partnerBranchId`, `userId`, `role` (`STAFF`/`MANAGER`,
  organizational only — permission tier still comes from `RoleName`),
  `employeeDisplayCode` (partner-unique, auto-generated `EMP-###` if not
  supplied, never reused after deactivation), `isActive`,
  `assignedByUserId`/`deactivatedByUserId` (audit trail). A composite FK on
  `(partnerId, partnerBranchId)` → `PartnerBranch(partnerId, id)` makes it
  impossible at the database level for an assignment to name a branch
  belonging to a different partner than the one it also names — no trigger
  required. A hand-written partial unique index enforces "at most one ACTIVE
  assignment per (user, branch)" while still allowing history (a deactivated
  row is never deleted, so the same person can be reassigned later).
- `PartnerBranchQrCode` — a branch's own scan-to-pay identity, extending the
  existing `QrCode.token` pattern (`generateOpaqueToken`) rather than a
  second QR system. It is a separate model from `QrCode` on purpose: `QrCode`
  is the *legacy* `POST /qr/redeem` flow, which permanently refuses
  `STATIC_MERCHANT` redemption, and answers a different question (a reusable
  fixed-amount invoice) than a branch code needs to (an identity with no
  amount, that always lands on `PurchaseIntentsService.create()`). Same
  composite-FK technique as staff assignments, plus a partial unique index
  for "at most one ACTIVE QR per branch." Rotation is revoke-then-issue in
  one transaction, never an update of an existing row.
- Four new `AuditAction` values: `BRANCH_STAFF_ASSIGNED`,
  `BRANCH_STAFF_DEACTIVATED`, `BRANCH_QR_ISSUED`, `BRANCH_QR_REVOKED`.

**Migration safety, verified the same way Problem 1 of the roaming-CPO task
was (2026-08-27):**
- Fresh deploy onto an empty database (`tutak_freshtest`): all 48 migrations
  apply cleanly.
- `prisma migrate diff --from-url <fresh-db> --to-schema-datamodel
  prisma/schema.prisma --exit-code`: **no difference detected** — the
  migration produces exactly what `schema.prisma` declares.
- Upgrade path: deployed every migration up to (and excluding) this one onto
  a second database, then applied this migration alone on top — succeeds
  cleanly, exactly the shape a real production upgrade takes.
- Manually verified both partial unique indexes and the composite FK with
  real inserts: a second ACTIVE assignment/QR for the same (user, branch) /
  branch is rejected; deactivating then reassigning the same person to the
  same branch succeeds; an assignment naming a branch that belongs to a
  *different* partner than the one also named is rejected by the FK itself.
- This migration is purely additive (new columns nullable/defaulted, new
  tables, new enum values) — nothing about it resembles the migration
  collision the roaming-CPO task's Problem 1 fixed, and no existing table's
  data is rewritten.

## Authorization model

`apps/api/src/common/auth/branch-scope.ts` is the new layer on top of the
existing `partner-scope.ts`:

- `isAllBranchOperator(user, partnerId)` — true for a platform admin, a
  `PARTNER_OWNER` scoped to that partner, or a `UserRole.allBranches` grant.
- `hasBranchScope(user, partnerId, branchId)` — requires ordinary partner
  scope first, then either `isAllBranchOperator` or membership in
  `RequestUser.branchIds`.
- `assertResourceBranchScope(user, partnerId, branchId | null)` — the check
  every `PurchaseIntent` endpoint uses: `branchId` null (a non-fuel
  partner's row, or a row from before this shipped) means unchanged,
  partner-only scoping; non-null means the caller must be scoped to that
  specific branch.
- `branchFilterFor(user, partnerId)` — `null` (no restriction) for an
  all-branch operator, otherwise the caller's actual `branchIds` array
  (possibly **empty**, which correctly renders as "see nothing" via
  `{ partnerBranchId: { in: [] } }` rather than an unfiltered list).

`RequestUser.branchIds`/`allBranchPartnerIds` are computed fresh on every
request inside `UsersService.buildRequestUserClaims` (the same method that
already re-checks `isActive`/`lockedUntil` per request) — a branch
deactivation or `allBranches` revocation takes effect on the very next
request, not at next login. Both fields are optional on the type so the
several dozen hand-built `RequestUser` fixtures across the existing test
suite keep compiling unchanged; the helpers treat a missing array like an
empty one.

**The fail-closed default this task specifically asked for:** every existing
`PARTNER_STAFF`/`PARTNER_MANAGER` role landed with zero
`PartnerBranchStaffAssignment` rows and `allBranches = false` the moment this
migration ran. For a partner that has branches, that is a real, deliberate
"unassigned" state — `list()`/`confirm()`/`reject()`/`refund()`/`get()`
all refuse a branch-scoped action until an owner/admin explicitly assigns a
branch. For a partner with **no** branches (the overwhelming majority —
grocery, cafe, single-location shops), nothing observable changes at all:
no `PurchaseIntent` of theirs ever carries a `partnerBranchId`, so every
branch check above is skipped via the `null`-branch path.

## Endpoints touched

**Branch classification** (`PartnersController`, owner-only, same tier as
the existing branch CRUD): `PATCH /partners/:id/branches/:branchId/fuel-type`.

**Branch staff** (new `PartnerBranchStaffController`/`PartnerStaffController`):
- `GET /partners/:id/branches/:branchId/staff` — branch-scoped read.
- `POST /partners/:id/branches/:branchId/staff` — owner-only; requires the
  target user already hold a partner-scoped `UserRole` (this only narrows an
  existing grant to a branch, it never manufactures partner access for an
  unrelated user).
- `PATCH /partners/:id/branches/:branchId/staff/:assignmentId/deactivate` —
  owner-only; the row is never deleted.
- `GET /partners/:id/staff` — the partner-wide roster (any partner-scoped
  caller).
- `PATCH /partners/:id/staff/all-branches` — owner-only, grants/revokes
  `UserRole.allBranches`.

**Branch QR** (new `PartnerBranchQrController`/`PartnerBranchQrResolveController`):
- `GET /partners/:id/branches/:branchId/qr` — branch-scoped read (view/print).
- `POST .../qr`, `POST .../qr/rotate`, `POST .../qr/revoke` — owner-only.
- `GET /partner-branch-qr/resolve/:token` — any authenticated user; resolves
  to `{partnerId, partnerBranchId, partnerDisplayName, branchName}` only —
  no amount, no rate, no other commercial data. An unknown, revoked, or
  since-closed-branch token all resolve to the same 404; there is no
  fallback to treating the scan as a general partner code.

**`PurchaseIntentsController`** (existing endpoints, now branch-scoped):
`create` (requires `partnerBranchId` for a `fuel`-category partner going
forward — validated against the branch actually belonging to the partner and
being open), `list` (queue, branch-filtered), `activity/daily` (analytics,
branch-filtered), `confirm`, `reject`, `refund`, `get`, `:id/refunds` — every
one now calls `assertResourceBranchScope`/`branchFilterFor` in addition to
the existing `assertPartnerScope`.

## Client changes

- **Mobile**: `parseBranchQrToken()` recognises a new `TUTAK-BRANCH:<token>`
  payload distinctly from the existing plaintext `TUTAK-PAY:` form (left
  untouched, still used by non-fuel/no-branch partners).
  `partnerBranchQrApi.resolve()` calls the new endpoint; `ScanQrScreen`
  resolves a branch token server-side before navigating, and treats a
  failed resolution as a scan failure — never a fallback to the plaintext
  path. The offline demo adapter (`mockAdapter.ts`) gained a matching mock
  route so the "every route the api modules can ask for" completeness test
  keeps passing.
- **Partner portal**: `/locations` gained, for a `fuel`-category partner
  only, a per-branch "Manage" panel (`BranchFuelTools.tsx`): fuel-type
  selector, QR issue/rotate/revoke + the current token, and a branch staff
  roster with deactivate. Assigning a *new* staff member takes a raw user
  ID — see "Known limitation" below.
- **Admin portal**: `/partners` gained an expandable "Branches" row per
  partner (`PartnerBranchAudit.tsx`) — every branch, its fuel type, open/
  closed state, active QR status, and assigned staff. Read-only by design:
  platform admins already bypass every branch-scope check on these read
  endpoints, and issuing/rotating/revoking a branch's QR or reassigning its
  staff stays the partner owner's own call.

## Tests

`apps/api/test/partner-branch-staff-and-qr.int-spec.ts` — 30 tests, all
against the real database through the actual controllers (no mocking of the
authorization layer). Covers: fuel-type classification (owner-only, never
guessed); staff assignment (requires an existing partner role, the partial
unique constraint surfaces as `ConflictException` not a raw 500,
reassignment after deactivation, owner-only, **cross-tenant IDOR** — a
branch belonging to a different partner 404s rather than 403ing, which
partial info leak); the `allBranches` exception (grant/revoke, owner-only);
branch-scoped `PurchaseIntent` authorization — the core IDOR surface —
covering the mandatory-branch-for-fuel-partner rule, the unassigned-staff
"sees nothing" state, branch-A-vs-branch-B on **list, confirm, reject,
refund, and direct-id GET**, the owner's and an `allBranches` manager's
unrestricted reach; and the branch QR lifecycle (issue, refuses a second
active code, revoke really invalidates, rotate invalidates the old token
while the new one works, owner-only mutation vs branch-scoped read, and a
branch's QR never resolves to a sibling branch of the same partner).

Two bugs were caught and fixed by writing these tests against the real
code, not assumed away:
1. `PartnerBranchStaffController.list()` throws its authorization check
   synchronously (same shape as the pre-existing `ev-charging` controller
   bug fixed in the roaming-CPO task) — the test needed a synchronous
   `expect(() => ...).toThrow()`, not `.rejects.toThrow()`.
2. `PartnerBranchStaffService.assign()` let a Postgres unique-constraint
   violation (either the partial "one active assignment" index or the
   partner-unique `employeeDisplayCode`) escape as a raw, unhandled
   `PrismaClientKnownRequestError` — a 500, not a clean 4xx. Fixed by
   catching `P2002` and raising `ConflictException`, the same pattern
   already used in `media.service.ts`/`settlement.service.ts` for the exact
   same situation.

## Full verification gate

- `npm run lint` (api): clean, zero warnings, across every new/changed file.
- `npm run typecheck` (api, mobile, partner, admin, shared-types): clean.
- Full backend suite: **93 suites / 1302 tests, all passing**, run with
  plain `jest --runInBand` (no `--forceExit`) — zero "did not exit"
  occurrences, confirmed no lingering process afterward. This reuses the
  exact hygiene the roaming-CPO task's Jest-hang fix established
  (2026-08-27/29): if a leak had been reintroduced, this run would have
  caught it the same way.
- Migration drift check (`prisma migrate diff --exit-code` against a fresh
  database): **no difference**.
- Mobile: 237/237 tests passing (one test — the mock-adapter route
  completeness check — required the new fixture noted above). A
  "worker process has failed to exit gracefully" warning appears after the
  suite reports all tests passed; this is a pre-existing Jest/RN worker-pool
  teardown notice, not a hang (the run completes and the process exits), and
  is unrelated to the routes this task added — it was not chased further
  given the standing instruction's scope is the backend Jest hang, which
  remains fixed.
- Partner portal: 35/35 tests passing.
- Admin portal: 34/34 tests passing.
- Full monorepo build: `api` (`nest build`), `admin` and `partner` (`next
  build`, Turbopack) all succeed with no errors.

## What was deliberately not built

- **No general "search staff by name/phone" feature.** Assigning a *new*
  person to a branch in the partner portal takes a raw user ID — the portal
  (and the admin portal) has no user-directory/typeahead anywhere today;
  partner-scoped role grants (`PARTNER_STAFF`/`PARTNER_MANAGER`) are
  themselves only ever issued via `AdminService.assignRole`, with no
  self-service UI in either portal, predating this task. Building a general
  user-search feature is a materially larger, separate piece of work than
  "branch assignment," so this task's UI works within that existing
  constraint rather than silently growing scope to cover it.
- **`listBranches` (the branch directory: name/address/city) stays
  partner-scoped, not branch-scoped.** It carries no transactional or
  financial data, so restricting it per-branch would only make an ordinary
  employee unable to see their own employer's other locations exist, for no
  security benefit — the enumerated concern in this task's own list (pending
  list, view, confirm, reject, refund, history, analytics, QR management)
  never included the branch directory itself.
- **The `BranchStaffRole` (`STAFF`/`MANAGER`) enum is organizational, not a
  second permission system.** What a person may *do* (confirm, refund,
  manage EV stations, ...) still comes entirely from `RoleName`/
  `PermissionName`/`UserRole`, unchanged. This task's job was narrowing
  *where* an existing grant reaches, never re-deciding *what* it grants —
  redesigning the permission tiers themselves was explicitly out of scope
  ("do not modify... other business modules").

## Explicitly out of scope, and untouched

No referral percentages, EV/CPO economics, charging prices, QR-purchasing
rules for non-fuel partners, or general UI design were touched. `git status`
for this change touches only: the new schema/migration, the new
branch-scope/staff/QR modules, the existing `PurchaseIntentsController`/
`PurchaseIntentsService` (branch-scope calls added, no business-rule
change), `PartnersController`/`PartnersService` (one new endpoint), the
`RequestUser` type and `buildRequestUserClaims` (two new optional/computed
fields), one new mobile QR-parsing function alongside the untouched existing
one, and the three portal pages named above.
