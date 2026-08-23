# Security hardening — secrets/config, Docker/deployment, auth boundary, partner integrations

**Date:** 2026-08-23.
**Branch:** `claude/tutak-loyalty-mvp-e485jm`.
**Scope requested by Arman, verbatim brief:** production-security hardening
across five areas — production secrets, PostgreSQL/Redis exposure, the
authentication boundary, `/integrations`, and verification — explicitly
*not* a redesign, business-rule change, or new feature.

This pass ran concurrently with a second background agent adding
UUID-shape validation to route parameters across `apps/api/src/modules/`
(`docs/PENTEST_2026-08-23.md` §B.2 / `docs/ID_VALIDATION_2026-08-23.md`).
The two scopes were kept disjoint in practice — no file both passes needed
to edit — see §F.

Every "confirmed" or "already-safe" claim below was reproduced against a
real system: the live API on `127.0.0.1:4000`, a real Postgres, real HTTP
requests, throwaway accounts registered through the actual OTP flow (codes
read from the API's own stdout), the actual compiled build attempting a
real production boot with bad and then good secrets, and `docker compose
config` resolving the actual compose file — never inferred from reading
code alone, per the task's verification standard.

---

## A. Confirmed vulnerabilities (fixed this pass)

### A.1. HIGH — Production could boot on the example JWT secrets committed in `.env.example`

**What was tested.** Whether `NODE_ENV=production` would start with
`.env.example`'s own placeholder secrets, and separately with two
different-but-identical strong secrets.

**Reproduced, before the fix.** `apps/api/src/config/env.validation.ts`
validated `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` with `@MinLength(32)`
only, in every environment. `.env.example`'s own values —
`change-me-access-secret-min-32-chars-long` (41 chars) and
`change-me-refresh-secret-min-32-chars-long` (42 chars) — both clear 32
characters, so the check never looked past length. Confirmed live by
calling the compiled `validate()` directly with `NODE_ENV=production` and
those two exact strings: it returned normally, with the placeholder
secrets in the returned config verbatim. Separately confirmed a
copy-paste mistake (one random 64-hex-char value pasted into both
`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`) also passed silently.

**Why it matters.** `docs/DEPLOYMENT.md` already documented "different
from the above" as the intended shape for the refresh secret — the intent
was on record, just never enforced. A JWT secret is the entire trust
boundary of the authentication system: anyone who knows or guesses it can
forge an access token for any user, any role, any partner scope, with no
further exploit needed. `.env.example`'s placeholder values are public
(committed to this repository); a deployment that copied them forward
un-rotated — an easy mistake with only a length check standing in the
way — would be trivially, silently compromised.

**Fix.** `apps/api/src/config/env.validation.ts` gained
`assertProductionJwtSecretsAreStrong()`, called from `validate()`
(the function `ConfigModule.forRoot` invokes at boot, so this runs before
any other module instantiates). Production-only, matching the
`SmsModule`/`MediaStorageModule`/`PaymentsModule` "refuse to boot" pattern
already used elsewhere in this codebase. Refuses to start when either
secret:

- matches a known placeholder pattern (`change-me`/`change-this`,
  `example`, `placeholder`, `your-secret`, `secret`, `password*`,
  `insecure`, or a `test-`/`dev-`/`demo-`/`sample-`/`dummy-`/`fake-secret`
  prefix, or an all-`x` string);
- is low-entropy (fewer than 8 distinct characters across the string —
  catches a repeated or short cyclic pattern padded out to 32+ characters);
- is identical to the other secret.

**A real false positive was caught and fixed during verification, not
shipped.** The entropy check was first written as "fewer than 16 distinct
characters," reasoning that `openssl rand -hex 32` clears it easily. It
does not, reliably: hex has only 16 *possible* distinct characters, and a
20,000-sample statistical check of genuinely random hex strings (run
during this pass, `python3` one-liner, see the code comment on
`hasLowEntropy`) found real ones landing as low as 9 distinct characters
by chance — a threshold near 16 would have randomly refused roughly a
quarter of perfectly good, freshly-generated production secrets on
`openssl rand -hex 32`'s own recommended workflow. Caught by running 10
live boot attempts with fresh `openssl rand -hex 32` pairs before treating
the guard as done — 2-3 of them failed with the 16-char threshold. Lowered
to 8 (verified against the same 20,000-sample distribution: zero false
positives at 32+ characters), rebuilt, and re-verified with 10 more live
boot attempts, all clean.

**A second, unrelated regression was caught by the full test suite and
fixed.** `apps/api/test/production-boot.int-spec.ts` (pre-existing, not
written this pass) boots a real `NODE_ENV=production` Nest context nine
times to test PSP/media-storage boot guards, but never set
`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` itself — it inherited whatever was
already in `process.env`. In this sandbox specifically, that turned out to
be the literal `change-me-*` placeholder text from a leftover local
`apps/api/.env` file, leaked into the Jest worker's environment by
Prisma's own auto-`.env`-loading during `globalSetup` (`new PrismaClient()`
loads every variable in a discovered `.env` file into `process.env` for
any key not already set, and it runs — and completes — before this file's
own `jest-setup.ts` defaults are applied in the worker that later runs the
actual tests). Before this pass's JWT guard existed, this ambient leak was
harmless — nothing checked the *shape* of the secret. Once the guard
existed, 8 of this file's 9 tests started failing: each one now hit the
new "placeholder JWT secret" rejection first, before ever reaching the PSP
or media-storage guard the test was actually trying to exercise. Root-caused
by adding temporary debug logging to confirm the exact leak path (removed
before committing), then fixed properly: the fixture now generates and
sets two strong, distinct `openssl`-equivalent secrets itself
(`randomBytes(32).toString('hex')`, saved/restored per test like every
other env var this file already manages) rather than depending on ambient
process state for something security-critical — a fix that makes the test
harness more correct independent of *why* the ambient value was
unreliable in this particular sandbox. Verified: all 9 tests in this file
pass again, and the full `apps/api` suite (§E) confirms nothing else was
affected.

**Verified live, after the fix, against the real compiled build**
(`node dist/main.js`, real Postgres/Redis, real `NODE_ENV=production`):

| Boot attempt | Result |
| --- | --- |
| `.env.example`'s exact placeholder secrets | Refused: `Refusing to start in production with unsafe JWT secrets: JWT_ACCESS_SECRET looks like a placeholder/example value...` |
| Two different strong (`openssl rand -hex 32`) secrets, ×10 fresh trials | All 10 booted past the JWT gate cleanly (next failure, if any, was an unrelated pre-existing guard — see below) |
| One strong secret copy-pasted into both variables | Refused: `...must not be the same value` |
| A 40-character repeated single character (`zzzz…z`) as the access secret | Refused: `...does not look cryptographically random` |
| Empty access secret | Refused by the pre-existing `@MinLength(32)` check, unchanged |
| Development / test environments, same placeholder secrets | Boots unaffected — the guard is production-only, confirmed by `NODE_ENV=development` and `NODE_ENV=test` boot attempts with the exact `.env.example` values |

The "two strong secrets" boot attempt's next failure, once past the JWT
gate, was `PUSH_ENABLED must be true in production, with PUSH_ENDPOINT
configured` — a pre-existing, unrelated `PushModule` guard, not a new
finding. It confirms the JWT gate does not block a legitimate deployment;
it simply isn't the last guard standing before boot succeeds, which
requires every commercial credential from `docs/DEPLOYMENT.md` §1, not
just JWT secrets.

**Regression tests.** `apps/api/src/config/env.validation.spec.ts` (new,
20 tests): every rejected shape above pinned individually, a no-op check
for `development`/`test` with the exact placeholder values, an
"every problem reported at once" test, and — the false-positive regression
— 200 trials of freshly-random hex *and* base64 secret pairs (the two
encodings this repo actually documents), asserting every single one clears
the guard.

**Files changed:** `apps/api/src/config/env.validation.ts`,
`apps/api/src/config/env.validation.spec.ts` (new).

### A.2. MEDIUM — `render.yaml`'s Postgres had no `ipAllowList`, unlike its Redis

**What was tested.** Whether the production Render Blueprint
(`render.yaml` — the one deployment config this repository actually ships
for a real environment, per `docs/DEPLOYMENT.md`) restricts network access
to Postgres and Redis.

**Reproduced.** Reading `render.yaml`: the Redis `keyvalue` service
already carried `ipAllowList: []` with a comment explaining it as
"reachable only from inside the Render network." The `databases:` entry
(`tutak-db`, the Postgres instance) had no `ipAllowList` at all. Confirmed
via Render's own published documentation (fetched during this pass) that
omitting `ipAllowList` on a Render Postgres instance is **not**
private-by-default — it explicitly allows connections from any IP with
valid credentials, i.e. brute-force/credential-stuffing exposure to the
entire internet, for the one component in this stack that holds every
customer's data and every ledger row.

**Why it matters.** The Redis instance right next to it in the same file
already had the fix; the Postgres instance — holding the actual financial
and personal data — did not. A stolen or guessed `DATABASE_URL` password
would otherwise be reachable from anywhere, not gated on also being on
Render's private network the way Redis already is.

**Fix.** Added `ipAllowList: []` to the `tutak-db` entry, identical to the
Redis line, with a comment explaining why. `tutak-api` (same Render
region) continues to reach it over Render's internal network regardless —
Render documents the allow list as applying to external connections only.

**Verified.** Read the exact resulting YAML; `render.yaml` was never a
live-deployed target for this repository (documented in the file itself as
"has NOT been deployed"), so there is no running instance to hit with a
live connection attempt — the fix and its correctness are evidenced by the
file diff plus Render's own documented `ipAllowList` semantics, not a live
network probe. Noted plainly rather than overclaimed.

**Files changed:** `render.yaml`.

### A.3. LOW — `docker-compose.yml` published Postgres/Redis to every host interface, not just loopback

**What was tested.** Whether the compose file's own port mappings expose
Postgres/Redis beyond the local machine.

**Reproduced.** `ports: ["5432:5432"]` and `["6379:6379"]` (no host IP
qualifier) bind to `0.0.0.0` by default — every interface on the host, not
just `127.0.0.1`. Confirmed by resolving the actual file with
`docker compose config` (Docker CLI is present in this sandbox; the daemon
is not, so `config` — which only parses/resolves, no daemon required — was
used rather than actually booting the stack): before the fix, the merged
config's `ports` entries carried no `host_ip` at all, meaning Docker's
default of `0.0.0.0`.

**Why it matters.** `docs/DEPLOYMENT.md` already documents
`docker-compose.yml` as a *local* stack, and the file's own WAL-archiving
comment admits it: "this file is the template people copy onto a server."
On a developer's laptop behind a home/office firewall this is low-risk;
copied onto a cloud VM with a public IP and no firewall, it puts Postgres
and Redis on the open internet with only their passwords standing guard —
exactly the exposure the brief asked to rule out. Brief's own guidance:
"local development may keep localhost mappings" — the fix keeps exactly
that, tightened from "every interface" to "loopback only."

**Fix.** Both ports now bind explicitly:
`"127.0.0.1:5432:5432"` / `"127.0.0.1:6379:6379"`.

**Verified live.** `docker compose -f docker-compose.yml config` (Docker
CLI present, daemon not running in this sandbox — see §D for what this
does and does not prove) resolves both port entries to `host_ip:
127.0.0.1` after the fix, confirmed by direct inspection of the resolved
config output. Local development is unaffected: any tool on the host
machine itself (`psql -h localhost`, `redis-cli -h localhost`) reaches the
loopback-bound port exactly as before; only off-host reachability changes.

**Files changed:** `docker-compose.yml`.

### A.4. Documentation gap — no firewall/network-requirements section existed

Arman's brief explicitly asked to "document firewall/network
requirements." No such section existed in `docs/DEPLOYMENT.md` before this
pass. Added **§1a. Network / firewall requirements — Postgres and Redis**,
covering: what this repository's own files now enforce (A.2, A.3 above),
what `railway.json` does and does not provision (build/deploy config only —
no Postgres/Redis definition exists there; a real Railway deployment adds
those as separate managed services outside this repo), the explicit
absence of any `docker-compose.prod.yml` or other production-specific
infrastructure file (`infra/docker/` exists but is empty — stated plainly
rather than inventing one speculatively), and concrete guidance for anyone
self-hosting Postgres/Redis outside a managed provider (never publish
5432/6379 to a public interface; if unavoidable, restrict by
security-group/firewall rule to the API server's own IP, never
`0.0.0.0/0`). Closes with an explicit "what this cannot cover" — a cloud
firewall or VPC configuration lives outside this repository and has to be
verified by whoever operates the actual deployment.

**Files changed:** `docs/DEPLOYMENT.md`.

---

## B. Already-safe findings (reproduced live, not assumed)

### B.1. JWT validation

`JwtStrategy.validate()` (`apps/api/src/modules/auth/strategies/jwt.strategy.ts`)
re-fetches the caller's roles/permissions/partner scopes from the database
on *every* request via `UsersService.buildRequestUserClaims()` — nothing
about a user's authorization is baked into the token itself beyond `sub`,
`phone`, `deviceId`. Confirmed by reading the strategy and by every live
request in this pass succeeding/failing exactly as the caller's *current*
database role dictated (e.g. a partner owner's scope was re-evaluated on
each of the six live integration-endpoint calls in §B.6, not cached from
token issuance).

### B.2. Refresh-token rotation and reuse detection (H1/H10)

Live test: registered a throwaway account, obtained a refresh token,
rotated it once (succeeded, issued a new pair), then replayed the
*original* (now-superseded) refresh token — rejected `401`. The
newly-issued token from that same rotation was then also immediately dead
(`401`) — confirming reuse detection revokes the *entire* device token
family, not just the replayed token, exactly as
`AuthService.handleReuse()` documents. Rotation itself is an atomic
conditional update (`updateMany({ where: { revokedAt: null } })`), not a
read-then-write, so two concurrent presentations of one token cannot both
succeed. Server log confirmed a `FraudSignalType.DEVICE_MISMATCH` signal
was raised on the reuse attempt, as designed.

### B.3. Login/OTP/password-reset rate limits

Every OTP-issuing, login, and password-reset route in
`AuthController` carries its own `@Throttle`, distinct from the
platform-wide default (`register`: 5/60s; `login`: 8/60s;
`register/request-otp` and `login/request-otp`: 5/300s;
`register/verify-otp` and `login/verify-otp`: 10/300s;
`password-reset/request`: 3/300s; `password-reset/confirm`: 5/300s).
Live test: called `login/request-otp` for an unregistered number 8 times
in a row — the first 5 returned `201`, the next 3 returned `429` with no
information disclosure, exactly matching the configured limit.

### B.4. CORS fails closed

Live test: an `OPTIONS` preflight from `Origin: https://evil.example.com`
returned no `Access-Control-Allow-Origin` header at all (rejected, not
reflected); the identical preflight from an allow-listed origin
(`http://localhost:3000`, this environment's configured `CORS_ORIGINS`)
correctly returned `Access-Control-Allow-Origin: http://localhost:3000`.
`main.ts` also still throws at boot if `CORS_ORIGINS` is empty on a
public-facing (`staging`/`production`) `NODE_ENV` — unchanged, confirmed
by reading the boot guard, consistent with prior hardening record.

### B.5. Security headers

**API:** live `curl -i` against `/health` and the CORS preflight above
both returned the full `helmet()` header set — `Content-Security-Policy`,
`Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`,
`Cross-Origin-Opener-Policy`, `Referrer-Policy`, and more — unchanged from
prior hardening passes.

**Dashboards:** `packages/design/security-headers.mjs` (shared by both
`apps/admin` and `apps/partner`) builds a CSP scoped to `'self'` plus the
API origin for `connect-src`/`img-src` only (no wildcard hosts), sets
`frame-ancestors 'none'`, `X-Frame-Options: DENY`,
`Strict-Transport-Security` outside development, and `Permissions-Policy`
denying camera/microphone/geolocation/payment/usb. Confirmed wired into
both apps' `next.config.ts` (`import { securityHeaders } from
'@tutak/design/security-headers'`, both call it in their `headers()`
export) and confirmed both dashboards still build cleanly with it in place
(`next build`, both apps, §E).

### B.6. Partner integrations — OWNER-only, no self-verification, no activation without TuTak approval

This section directly answers the brief's two pointed asks beyond the
already-recorded OWNER-permission decision.

**Static check:** `grep -rn "PartnerIntegrationStatus.ACTIVE"
apps/api/src` finds exactly **one** place in the entire backend that ever
sets a `PartnerIntegration` to `ACTIVE` —
`PartnerIntegrationsService.markWebsiteVerified()`, reachable only through
`POST /partners/:partnerId/integrations/:integrationId/verify-website`,
gated by `assertPlatformAdmin()`. `create()` never sets `ACTIVE` under any
input — `WEBSITE` starts `PENDING_VERIFICATION`, every other type starts
`NOT_CONNECTED` and has **no** activation path coded anywhere in this
codebase (matching `docs/NEXT_CLAUDE_TASK.md`'s recorded decision to defer
generic auto-finalization). So: no request, from anyone, can activate an
integration without going through the one admin-only endpoint. This is
the direct answer to "ensure requests cannot activate an integration
without TuTak approval."

**Live HTTP reproduction** (fresh throwaway accounts via the real OTP
flow; two real partners created through the admin API; a real bearer token
per role):

| Call | Actor | Result |
| --- | --- | --- |
| `POST /partners/:A/integrations` (`type: WEBSITE`) | Partner A's real OWNER | `201`, `status: PENDING_VERIFICATION` — never `ACTIVE` on creation |
| `POST /partners/:A/integrations/:id/verify-website` | The **same** OWNER, on their **own** partner's **own** integration | `403 "Verifying a partner website is restricted to platform administrators"` — direct answer to "website verification ownership": a partner cannot verify their own claimed website under any circumstance, full stop |
| `GET /partners/:A/integrations` | An unrelated outsider account (no scope on A) | `403 "You are not authorized to act for this partner"` |
| `POST /partners/:A/integrations` | Same outsider | `403`, same message |
| `POST /partners/:B/integrations/:idFromA/verify-website` | Platform admin, but with **partner B's** id in the URL against an integration that belongs to **partner A** | `400 "This integration does not belong to the given partner"` — the partnerId/integrationId cross-check holds |
| `POST /partners/:A/integrations/:idFromA/verify-website` | Platform admin, correct partner | `201`, `status: ACTIVE`, `websiteVerifiedAt` set |

**On the underlying verification method itself:** there is no automated
domain-ownership check anywhere in the codebase (no DNS TXT lookup, no
meta-tag fetch) — the code's own comment records this as a deliberate,
still-open business decision ("TODO: BUSINESS DECISION REQUIRED — the real
verification method... is not specified anywhere"), not a hidden gap. The
practical consequence is the opposite of a vulnerability: with no
automated check to fool, the *only* way a `WEBSITE` integration reaches
`ACTIVE` is a human platform administrator manually attesting to it, which
is exactly the "no activation without TuTak approval" property the brief
asked to confirm.

**Integration test suite**, run live against a real Postgres this pass
(pre-existing, not modified): `apps/api/test/partner-integrations.int-spec.ts`
— 21/21 passing, covering both properties above plus tenant isolation, the
manager-vs-owner restriction, and per-type creation behavior. See §E for
the full run.

### B.7. IDOR

- Partner integrations: covered live in B.6 above (cross-tenant 403s on
  list/create, cross-tenant 400 on the partnerId/integrationId mismatch).
- User-scoped resources have no id-addressable route to attack in the
  first place: live probes at `GET /v1/wallet/:otherUsersId` and
  `GET /v1/users/:otherUsersId` both returned `404 Cannot GET` — the
  routes simply do not exist; wallet/profile reads are `/me`-shaped only.
- `docs/PENTEST_2026-08-23.md`, completed the same day this pass started,
  already ran an extensive live IDOR sweep specific to the media system
  (signed-URL tampering, cross-partner asset access, consent
  revocation-under-race) with concrete reproduction for each — not
  re-litigated here per this task's own instruction not to re-prove what a
  same-day companion document already verified end-to-end.
- The pre-existing `apps/api/test/idor-sweep.int-spec.ts` suite (not
  written this pass) covers notifications, transactions and other
  id-taking routes; see §E for its status in this pass's own run.

### B.8. No committed credentials or private keys

`git log --all --diff-filter=A --name-only | grep -E '\.env$'` — empty, no
`.env` file has ever been added in this repository's history.
`git log --all --diff-filter=A --name-only | grep -iE '\.pem$|\.key$|id_rsa|\.p12$|\.pfx$'`
— empty. Broad grep for private-key headers and AWS-key-shaped strings
across all tracked `.ts`/`.js`/`.json`/`.yml` files — no matches.
`.gitignore` covers `.env`, `.env.local`, `.env.*.local`,
`apps/api/.media-storage/`, `dump.rdb`, `backups/` (all explicitly
excluding `.env.example`, which correctly stays tracked and contains only
placeholders). This sandbox's own local `.env`, `apps/api/.env`, and
`dump.rdb` were confirmed `git status --ignored` as ignored, never staged.

### B.9. No production debug endpoints

`grep -rln "debug\|Debug" apps/api/src/modules/**/*.controller.ts` — no
matches; no debug controller exists anywhere. The one endpoint that
resembles a bypass, `POST /auth/demo-session`, answers `404` unless
`DEMO_MODE=true` is explicitly set (confirmed by reading
`DemoSessionService`'s own guard) — a production deployment that never
sets `DEMO_MODE` does not advertise the route at all, and the endpoint
itself grants nothing a real login with the seeded demo password would
not. Swagger (`/docs`) is compiled out entirely (not just hidden) on
`staging`/`production` — `main.ts`'s `if (!isPublicFacing)` guard around
`SwaggerModule.setup`, unchanged from prior hardening.

---

## C. What was not re-litigated

Per this task's own framing and the repository's established practice of
not re-proving what a same-day companion document already verified:

- The media system's signed-URL/consent/two-party-approval IDOR
  properties — see `docs/MEDIA_SYSTEM_2026-08-23.md` and
  `docs/PENTEST_2026-08-23.md` §C, both read before starting this pass.
- Route-parameter UUID-shape validation — addressed by a concurrent
  background agent this session (`docs/ID_VALIDATION_2026-08-23.md`,
  `apps/api/src/common/decorators/uuid-param.decorator.ts`, commit
  `1ee62d4`, already merged to this branch), flagged as LOW/systemic and
  explicitly out of scope for the media pentest pass
  (`docs/PENTEST_2026-08-23.md` §B.2) and for this one — this document does
  not duplicate that work or its verification.
- Partner Integrations OWNER-only gating on `create`/`list` —
  already recorded as resolved in `docs/NEXT_CLAUDE_TASK.md`
  (2026-08-18) and re-confirmed as still holding, live, in §B.6 above
  rather than re-implemented.

---

## D. Honest limits of this pass

- **Docker was not actually run.** The sandbox this pass ran in has the
  Docker CLI installed but no running daemon
  (`docker info` → `failed to connect to the docker API ... daemon is
  running: dial unix /var/run/docker.sock: connect: no such file or
  directory`). `docker compose config` — which only parses and resolves
  the compose file, no daemon required — was used to prove the port-bind
  fix resolves correctly (§A.3); the full stack was never actually booted
  in containers during this pass. Stated here rather than implied.
- **`render.yaml` has never been deployed**, by its own header comment,
  predating this pass. The `ipAllowList` fix (§A.2) is evidenced by
  Render's own documented semantics and the file diff, not a live
  connection test against a running Render Postgres instance, because none
  exists for this repository.
- **No cloud firewall or VPC configuration can be verified from inside
  this repository**, for any real deployment that does not yet exist. §A.4
  documents the requirement; confirming an actual production host has
  5432/6379 closed to the public internet is necessarily an operational
  step for whoever stands up that deployment, not something a repository
  audit can certify in advance.
- Sections 3/4 of the brief were reviewed broadly but not exhaustively —
  this pass prioritized live reproduction of the brief's own named,
  pointed items (refresh rotation, rate limits, CORS, headers, partner
  OWNER/verification/activation) plus spot-checks (a wallet/user IDOR
  probe, the RBAC helper module) over a from-scratch re-sweep of every
  endpoint in the API, consistent with the brief's own instruction not to
  re-fix what is already fixed and to show evidence rather than manufacture
  busywork.

---

## E. Test results

Run in this session's sandbox: real Postgres, real Redis, the actual
compiled build.

| Command | Result |
| --- | --- |
| `apps/api`: `npx nest build` | PASS |
| `apps/api`: `npx jest --selectProjects unit --testPathPattern env.validation` | **PASS — 20/20** (new suite) |
| `apps/api`: `npx jest test/production-boot.int-spec.ts` | PASS — 9/9 (pre-existing suite; 8/9 regressed then were fixed — see §A.1) |
| `apps/api`: `npx jest --selectProjects integration --testPathPattern partner-integrations` | PASS — 21/21 (pre-existing suite, re-confirming §B.6 live) |
| `apps/api`: **full suite**, `npx jest --selectProjects integration unit --testTimeout=30000` | **PASS — 1114/1114 tests, 78/78 suites** |
| `apps/api`: `npx eslint src/config/env.validation.ts src/config/env.validation.spec.ts test/production-boot.int-spec.ts` | PASS — 0 problems |
| `apps/api`: `npx prisma migrate status` | "Database schema is up to date!" — 38 migrations, no drift |
| `apps/mobile`: `npx jest` | PASS — 225/225, 28/28 suites |
| `apps/admin`: `npx jest` | PASS — 29/29, 5/5 suites |
| `apps/admin`: `npx next build` | PASS — compiled, typechecked, 14/14 static pages generated |
| `apps/partner`: `npx jest` | PASS — 16/16, 2/2 suites |
| `apps/partner`: `npx next build` | PASS — compiled, typechecked, 11/11 static pages generated |
| `npm run typecheck` (turbo, whole monorepo) | PASS — 7/7 packages |
| `npx eslint apps packages tools` (whole monorepo) | PASS — 0 problems |
| Production boot, `.env.example`'s exact JWT secrets | Refused to start, as designed (§A.1) |
| Production boot, 10× fresh `openssl rand -hex 32` pairs (before the entropy-threshold fix) | 2-3 of 10 falsely refused — caught the false positive (§A.1) |
| Production boot, 10× fresh `openssl rand -hex 32` pairs (after the fix) | All 10 started past the JWT gate cleanly |
| Production boot, duplicated strong secret | Refused to start, as designed |
| Production boot, low-entropy secret | Refused to start, as designed |
| `docker compose -f docker-compose.yml config` | Resolves `host_ip: 127.0.0.1` for both Postgres and Redis (§A.3) |

**Note on the full-suite run.** Two runs of the full suite collided
mid-pass: this session and a concurrently-running UUID-validation pass
both independently started `npx jest --selectProjects integration unit`
against the same `tutak_test` database at the same time.
`jest.config.js`'s own comment warns this exact scenario deadlocks/corrupts
fixtures ("every integration suite shares one database and truncates
between tests"), and the resulting run showed exactly that signature — `No
record was found for a query` / `Foreign key constraint violated` errors on
rows a concurrent `truncateAll` had removed mid-test — alongside 8 genuine
failures in `production-boot.int-spec.ts` that were the actual regression
described in §A.1. Both duplicate runs were stopped and the suite was run
once, serially: it surfaced only the 8 genuine `production-boot` failures
(no contention artifacts), which were then root-caused and fixed. The run
recorded in this table (1114/1114) is that final, single, uncontended run,
executed after a session interruption and this sandbox's Postgres/Redis
services being restarted — rebuilt (`nest build`) and re-verified against
the fresh build before this run.

---

## F. Migrations

None. This pass touched configuration/validation code, deployment YAML,
and documentation only — no Prisma schema change, no new migration.
`npx prisma migrate status` confirms zero drift against the 38 existing
migrations.

---

## G. Files changed

- `apps/api/src/config/env.validation.ts` — production-only JWT secret
  strength guard (§A.1).
- `apps/api/src/config/env.validation.spec.ts` (new) — 20 regression tests
  for the guard, including the 200-trial false-positive regression.
- `apps/api/test/production-boot.int-spec.ts` — pre-existing fixture fixed
  to set its own strong, explicit JWT secrets instead of depending on
  ambient `process.env` state (§A.1's second regression).
- `docker-compose.yml` — Postgres/Redis ports bound to `127.0.0.1` (§A.3).
- `render.yaml` — `ipAllowList: []` added to the Postgres database (§A.2).
- `docs/DEPLOYMENT.md` — new §1a (firewall/network requirements),
  expanded JWT-secret guard documentation (§A.1, §A.4).
- `docs/SECURITY_HARDENING_2026-08-23.md` (this document).

No file inside `/integrations` business logic, no route handler, no
Prisma schema, and no file the concurrent UUID-validation pass touched
(`apps/api/src/modules/**/*.controller.ts`,
`apps/api/src/common/decorators/uuid-param.decorator.ts`,
`apps/api/test/id-validation.int-spec.ts` — merged and pushed to this
branch as `1ee62d4` before this pass's own commit) was modified here.

---

## H. Remaining launch blockers

Nothing found in this pass's scope blocks launch on its own — every
confirmed vulnerability (§A) is fixed and verified above. Carried forward
from prior audits, still accurate and still outside what a repository
change can close:

- **External credentials/infrastructure** this repository cannot supply
  itself: a real SMS carrier account, a real `CORS_ORIGINS` pointed at
  real dashboard hostnames, TLS termination, and — newly documented this
  pass — verifying the actual production host has 5432/6379 closed to the
  public internet (§A.4), since no cloud firewall can be checked from
  inside this repository. See `docs/DEPLOYMENT.md` §1/§1a/§4.
- **Route-parameter UUID validation** (LOW, systemic, pre-existing) —
  was never a launch blocker (the existing generic-500 handling was
  already confirmed safe, no information disclosure,
  `docs/PENTEST_2026-08-23.md` §B.2) and is now closed: the concurrent
  background agent finished it this session, committed as `1ee62d4`
  (`fix(api): validate route-parameter ids as UUIDs before Prisma`,
  `docs/ID_VALIDATION_2026-08-23.md`) and already merged to this branch
  ahead of this pass's own commit.
- **`render.yaml` remains undeployed** — the `ipAllowList` fix (§A.2) is
  correct by Render's documented semantics but has never been exercised
  against a live Render Postgres instance, because this repository has
  never deployed one. Worth a real deploy-and-verify pass before this
  blueprint is used for anything beyond a demonstration.
- Every other item already recorded as resolved in
  `docs/NEXT_CLAUDE_TASK.md` and `docs/HARDENING_AUDIT_2026-08-16.md`
  remains resolved — re-confirmed rather than re-opened where this pass's
  scope touched them (§B).
