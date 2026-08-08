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
REDIS_URL=redis://:<redis password>@host:6379
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

## 5a. Alerts — who gets told when money is at risk

Set `ALERT_WEBHOOK_URL` to a Slack/Mattermost/Discord incoming webhook, or to
anything that accepts a JSON POST. Three events reach it, and they are the
three that mean money is at risk while nothing else in the system notices:

| Event | What it means |
|---|---|
| `reconciliation.drift` | The ledger disagrees with itself or with a bank statement. Payouts are already blocked for the partners involved. |
| `outbox.dead-letter` | An event exhausted its retries. Something the platform promised itself it would settle has not settled. |
| `sweep.failed` | A background job stopped retrying: bonuses are not expiring, sessions are not closing, or nothing is being reconciled. |

The same alert key stays quiet for fifteen minutes after firing. That window
is measured against the one-minute outbox drain, which would otherwise send
sixty notifications an hour forever — and the failure mode being avoided is
not noise but an operator muting the channel, which is worse than no alerting
because it still looks alive. Suppression state lives in Redis, so three
replicas noticing the same problem produce one notification.

Like tracing and unlike SMS, a missing webhook does **not** stop the process:
it warns at startup instead. Refusing to serve payments because a
notification endpoint is unset would take the platform down at the exact
moment someone was fixing the webhook.

Test it before you rely on it — post to the URL by hand and confirm the
message arrives where a human will see it at 3am, not in a channel nobody
opens.

## 5b. Metrics

`GET /metrics` serves the Prometheus text exposition format, gated on
`METRICS_TOKEN` as a bearer token. **Unset disables the endpoint** rather
than opening it: these are the operating figures of the business — revenue
per hour, outstanding liability, how much is sitting in clearing — and an
accidentally public metrics endpoint is the classic way that data leaks
quietly. Generate the token with `openssl rand -hex 32`.

Scrape config:

```yaml
scrape_configs:
  - job_name: tutak-api
    metrics_path: /metrics
    authorization:
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ['api:4000']
```

The metric worth putting on a wall is `tutak_ledger_imbalance_amd`. Every
account balance summed must be exactly zero; anything else means money was
invented or lost. Alert on `!= 0` and treat it as a page, not a ticket.

Also exposed: per-account balances, outbox pending and dead-lettered counts,
pending payouts and their value, payments and points in the last hour,
and `tutak_reconciliation_age_seconds` — which reads `-1` when reconciliation
has never run, so a fresh deployment cannot be mistaken for one that
reconciled a moment ago.

Everything is derived from the database at scrape time rather than counted in
the process, because in-process counters reset on deploy and are per-replica:
two instances would each report half the truth.

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
- **Redis.** It holds rate-limit counters, advisory locks and the job
  schedule, all of which regenerate — the schedule is re-upserted on the next
  boot. Losing it costs a moment of throughput and one skipped tick per job,
  not data. Jobs in flight when it dies are lost, which is why the work behind
  each one is idempotent and re-runs on the next tick.

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

Recurring work — settlement, bonus promotion and expiry, EV cleanup, nightly
reconciliation — runs on a BullMQ worker rather than in-process cron, so
adding instances adds capacity instead of duplicate ticks. The schedule lives
in Redis as one row per job, upserted on boot by whichever instance starts;
every recurring job in the platform is listed in
`apps/api/src/modules/sweeps/sweeps.jobs.ts`.

Two operational consequences worth knowing:

- **`SWEEPS_ENABLED=false` gives a web-only instance.** It serves HTTP and
  runs nothing on a timer — useful if the sweeps are ever moved to their own
  deployment. At least one instance in the deployment must have sweeps on, or
  nothing settles and no customer's points ever become spendable.
- **`QUEUE_PREFIX` separates environments.** Two deployments pointed at one
  Redis with the same prefix will drain each other's jobs.

Read replicas for analytics and transaction history are the next step after
that, and neither requires a change to the module boundaries.

Two numbers to set deliberately before adding instances, both measured in
`docs/LOAD_TEST.md`:

- **`connection_limit` on `DATABASE_URL`.** Unset, Prisma opens
  `num_cpus × 2 + 1` connections per instance. That is the ceiling the load
  test hit — throughput stopped rising at 32 concurrent captures while latency
  doubled. Raise it, but multiply by your instance count and keep the total
  under the database's `max_connections`, or a rolling deploy will exhaust the
  server while both versions are up.
- **Outbox drainers.** Settlement drains at roughly a third of the rate
  captures are produced under saturation. Irrelevant at a few hundred payments
  a day; the fix when it matters is more drainers, not a faster one, since the
  claim already uses `FOR UPDATE SKIP LOCKED` and is safe to run concurrently.

---

## 12. What is not covered here

Named rather than omitted:

- **Paging.** Alerts now reach a webhook (§5a) and metrics are exported
  (§5b), but nothing escalates: a message in a chat channel at 3am is only as
  good as whoever is looking at it. Wiring the webhook to an on-call rotation,
  or alerting on `tutak_ledger_imbalance_amd != 0` in whatever you use to
  page, is a decision about people rather than code.
- **Dashboards.** The metrics are exported; no Grafana board ships with them.
- **An external security review.** The code has been audited from the inside
  (`docs/AUDIT_*.md`) and hardened accordingly; nobody outside has tried to
  break it.
- **Legal.** Terms, data protection, KYC on partner payouts, tax treatment of
  loyalty points. None of it is engineering, all of it precedes real money.
