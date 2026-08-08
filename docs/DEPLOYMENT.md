# Deployment

`docker-compose.yml` and `scripts/demo-up.sh` describe a **local** stack: the
database password is in the file, every port is published to the host, and
`NODE_ENV` defaults to `development`. This document is the other thing — what
a real deployment needs, and why the application will refuse to start without
most of it.

---

## 1. What production refuses to run without

Three modules throw at boot rather than start in a degraded state. This is
deliberate, and it is the shape of the remaining work: none of it is code.

| Requirement | Enforced by | Why it is not a warning |
|---|---|---|
| A real acquirer | `PaymentsModule` | A sandbox adapter approves every charge. In production that is a platform that reports money it never took. |
| An SMS carrier (`SMS_ENDPOINT`) | `SmsModule` | A verification code written to stdout is indistinguishable from one that was delivered — until a real user is locked out by it. |
| Push delivery (`PUSH_ENABLED=true`) | `PushModule` | Nobody reports a notification they never knew was coming, so a silently disabled channel stays broken indefinitely. |
| `CORS_ORIGINS` | `main.ts` | An unset value used to mean "reflect any origin", which with credentials enabled is a fully permissive CORS policy. |

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are validated at 32 characters
minimum by `env.validation.ts` in every environment.

So the first production deploy is blocked on commercial decisions — an
acquirer contract, a carrier account, an Expo project — not on engineering.
Until those exist, the only honest deployment is a staging environment
running with `NODE_ENV=development`, which is what the demo stack already is.

---

## 2. The image

`apps/api/Dockerfile` produces the server image. `.github/workflows/docker-publish.yml`
builds and pushes it to GitHub Container Registry on every push to the
default branch and on `v*.*.*` tags, using the repository's built-in
`GITHUB_TOKEN` — no cloud account or secret has to exist for that half to
work.

```
ghcr.io/<owner>/<repo>/api:latest
ghcr.io/<owner>/<repo>/api:<sha>
ghcr.io/<owner>/<repo>/api:<version>   # on a tag
```

The dashboards have Dockerfiles too (`apps/admin`, `apps/partner`) but are
not published by that workflow yet — they are built by CI on every commit and
booted, which proves them, and publishing them is a one-line addition when
there is somewhere to deploy them to.

**The dashboards bake their API URL in at build time.** `NEXT_PUBLIC_API_BASE_URL`
is a build argument, not a runtime variable, because Next.js inlines it into
the browser bundle. A dashboard image built for staging cannot be promoted to
production unchanged; it has to be rebuilt with the production URL.

---

## 3. Migrations

`apps/api/docker-entrypoint.sh` runs `prisma migrate deploy` before the
process starts serving. That is safe to run unattended on every container
start, including a rolling deploy where several instances race: `migrate
deploy` only applies pending migrations in order and refuses on drift, so the
second and later instances find nothing to do and exit immediately.

It calls the Prisma binary directly rather than through pnpm, because a
container must not need the network to start.

**Before a migration that rewrites data**, take a backup (§7). Prisma will
not roll one back for you.

---

## 4. Environment

Everything below is read by `apps/api/src/config/configuration.ts`. See
`apps/api/.env.example` for the full annotated list.

### Required

```
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/tutak?schema=public
REDIS_URL=redis://host:6379
JWT_ACCESS_SECRET=<32+ random characters>
JWT_REFRESH_SECRET=<32+ random characters, different from the above>
CORS_ORIGINS=https://admin.example.am,https://partner.example.am
SMS_ENDPOINT=<carrier endpoint>
SMS_USERNAME=<carrier username>
SMS_TOKEN=<carrier token>
PUSH_ENABLED=true
```

### Worth setting deliberately

```
SMS_AUTH_SCHEME=basic|bearer        # basic suits Twilio, bearer most others
SMS_ENCODING=form|json
PUSH_ACCESS_TOKEN=                  # only once the Expo project enables enhanced security
BONUS_PENDING_HOURS=                # cooling-off before points become spendable
BONUS_EXPIRY_MONTHS=
RATE_LIMIT_TTL_SECONDS=
RATE_LIMIT_MAX_REQUESTS=
OTEL_EXPORTER_OTLP_ENDPOINT=       # e.g. https://otlp.your-collector.io
OTEL_EXPORTER_OTLP_HEADERS=        # e.g. api-key=...
OTEL_SERVICE_NAME=tutak-api
FEATURE_QR_LEDGER_MIRROR=false      # see §10
```

### Secrets

Generate the JWT secrets once, per environment, and store them wherever the
platform keeps secrets — not in the repository, not in a compose file.
Rotating `JWT_REFRESH_SECRET` signs every open session out; rotating
`JWT_ACCESS_SECRET` alone is nearly invisible to users, since access tokens
are short-lived and clients refresh automatically.

---

## 5. Tracing

Set `OTEL_EXPORTER_OTLP_ENDPOINT` and every request produces a span tree
covering HTTP, Postgres and Redis, with the service name and deployment
environment attached. Every JSON log line then carries the `traceId`
alongside the `requestId` it already had, so a log search and a trace viewer
point at the same incident.

Deliberately not a boot requirement, unlike SMS and push. Those two are how
a customer receives something and their absence is invisible until someone
is locked out; missing traces are visible to the operator the first time
they look. Refusing to serve payments because a telemetry collector is
unreachable trades a real outage for an observability gap.

Health probes are excluded from tracing — they fire every few seconds
forever and would bury real requests — as is filesystem instrumentation.

Spans are flushed on SIGTERM, so the requests in flight during a rolling
deploy are the ones you can still see afterwards.

## 6. Health and readiness

| Endpoint | Meaning |
|---|---|
| `GET /health` | The process is up. Use for liveness. |
| `GET /health/ready` | Postgres and Redis both answered. Use for readiness and for the load balancer. |

`/health/ready` returning `{"database":"ok","redis":"ok"}` is what the demo
script and CI wait on. A container that passes `/health` but fails
`/health/ready` should not receive traffic — it will accept requests and fail
them.

Both are unauthenticated by design, so keep them off the public hostname or
behind the load balancer's own network.

---

## 7. Backups

Two scripts, and one habit.

```bash
./scripts/backup.sh                        # dump to ./backups
./scripts/restore.sh --verify <dump>       # rehearse the restore, then throw it away
./scripts/restore.sh --into tutak_recovered <dump>
./scripts/restore.sh --force-into tutak <dump>   # overwrite; refuses without --force-into
```

`backup.sh` writes a compressed custom-format dump, then reads its table of
contents back and refuses to call it a backup unless every money-bearing
table is present. That catches the two silent failures — a truncated file,
and a dump taken against the wrong database — without restoring anything.

`restore.sh --verify` is the one that matters. It restores into a scratch
database, checks that every ledger account sums to zero and that each
account's stored balance still equals a replay of its own postings, and then
drops the scratch copy. Those two checks are what separate "the file parses"
from "the data inside it is a ledger you could run the business on". A
one-unit change to a single balance fails both.

Run the rehearsal on a schedule, not once. A backup nobody has restored is a
hypothesis, and the moment you need it is the worst moment to discover the
dump has been empty for three weeks.

### What the scripts do not do

- **Point-in-time recovery.** A nightly dump loses up to a day; PITR loses
  seconds. Every managed Postgres offers it — turn it on. These scripts are
  the second copy, not the first line.
- **Off-host storage.** `backups/` is on the same disk as everything else,
  which is no help when that disk is the thing that failed. Ship the dumps
  somewhere else — object storage, another region — and encrypt them: a
  dump contains every phone number and password hash on the platform.
- **Redis.** It holds rate-limit counters and advisory locks, all of which
  regenerate. Losing it costs a moment of throughput, not data.

`BACKUP_RETAIN_DAYS` (default 14) prunes older dumps from the output
directory.

## 8. First deployment, in order

1. **Provision** Postgres 16 and Redis 7. Managed instances are the right
   default — the platform's data is worth more than the saving.
2. **Set the environment** from §4. Confirm the app starts; if any of §1 is
   missing it will tell you exactly which.
3. **Let migrations run** on first boot via the entrypoint.
4. **Seed the baseline**, once:
   ```
   SEED_ADMIN_PASSWORD='<generated, stored in your secret manager>' \
     node dist/scripts/seed-baseline.js
   ```
   This creates permissions, roles and one super admin whose password is
   marked `mustChangePassword` — it reaches login and nothing else until it is
   rotated through `POST /v1/auth/change-password`.

   **Never run `seed-demo.js` against a real deployment.** It refuses without
   `TUTAK_DEMO=1` because it clears that rotation flag and creates accounts
   sharing one password.
5. **Rotate the admin password** through the app before doing anything else.
6. **Create the real partners** through the admin panel, not the seeder.
7. **Verify** `/health/ready`, then sign in, then check that the ledger screen
   reports every account in sync.

---

## 9. Recording money from the acquirer

Capture credits `PSP_RECEIVABLE` — a claim on the acquirer, not cash. When
the acquirer actually pays, an operator records it on the admin **Ledger**
screen from the remittance advice: amount, the acquirer's own reference, and
the day it landed. That posts `DR PLATFORM_BANK / CR PSP_RECEIVABLE`, and it
is what makes both accounts comparable with a real bank statement.

Deliberately manual. An inbound settlement asserts that money arrived, and
that assertion should come from a person reading the bank's own statement
rather than from an integration that could be compromised into creating cash
out of nothing. The endpoint is gated on `PAYOUT_MANAGE` — the same trust
level as sending money out — and the statement reference is unique, so two
operators working from the same email cannot enter it twice.

A remittance larger than the outstanding receivable is refused rather than
absorbed: that is the two sides disagreeing about what was captured, and it
needs a human before it needs a posting.

Once settlements are being recorded, `platformBank` can be passed to
`POST /v1/admin/reconciliation/run` alongside `pspReceivable`, and the
platform's own bank balance is reconciled like every other account.

## 10. The QR ledger cut-over

`FEATURE_QR_LEDGER_MIRROR` is off by default and should stay off through the
first deployment. It makes QR redemptions write double-entry postings
alongside the existing path, which stays authoritative. See
`docs/FINANCIAL_CORE_DESIGN.md` §9: turn it on, let a full settlement cycle
run, confirm reconciliation is clean against the mirror, and only then
consider retiring the old path. Switching both at once is the one change in
this system that could lose money quietly.

---

## 11. Scaling past one instance

Bonus-lot promotion and expiry run on in-process `@nestjs/schedule`, guarded
by a Redis advisory lock so that two instances do not sweep the same lots.
That is correct but wasteful — every instance wakes up to discover it lost the
lock. Before running more than two or three API instances, move those jobs to
a queue (BullMQ; Redis is already a dependency).

Read replicas for analytics and transaction history are the next step after
that, and neither requires a change to the module boundaries.

---

## 12. What is not covered here

Named rather than omitted:

- **Alerting.** Traces and structured logs exist and correlate; nothing
  wakes anybody up. Point the collector at something that pages, and decide
  what is worth paging for — a reconciliation run that finds drift and a
  dead-lettered outbox event are the two that mean money is at stake.
- **Metrics.** Tracing covers latency and errors per request. Business
  counters — payments per hour, points issued, payout volume — are not
  exported.
- **An external security review.** The code has been audited from the inside
  (`docs/AUDIT_*.md`) and hardened accordingly; nobody outside has tried to
  break it.
- **Legal.** Terms, data protection, KYC on partner payouts, tax treatment of
  loyalty points. None of it is engineering, all of it precedes real money.
