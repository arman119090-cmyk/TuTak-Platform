# Deployment

`docker-compose.yml` and `scripts/demo-up.sh` describe a **local** stack: the
database password is in the file, every port is published to the host, and
`NODE_ENV` defaults to `development`. This document is the other thing — what
a real deployment needs, and why the application will refuse to start without
most of it.

---

## Database connections

Prisma sizes its own pool when nothing says otherwise: `num_physical_cpus * 2
+ 1` per client process, with a 10-second checkout timeout. That is a
reasonable default and a poor one to scale on, because it is per process and
derived from whatever machine the process landed on. Four API instances on
2-vCPU containers ask PostgreSQL for 20 connections; the same four on 8-vCPU
containers ask for 68, with no change to any configuration. Past
`max_connections` PostgreSQL answers `FATAL: sorry, too many clients already`
— to every instance, for every request, including the health check that would
otherwise have pulled the failing instance out of rotation.

`DATABASE_CONNECTION_LIMIT` states the answer instead of inheriting it.
Unset, nothing changes. Set, it is written into the connection string Prisma
opens with — and it never overrides a `connection_limit` already present in
`DATABASE_URL`, because whoever put it there has already decided.

The arithmetic, which only the deployment can do:

```
per_instance = (max_connections - reserved) / api_instances
```

- `max_connections` — ask the database, not the documentation:
  `SHOW max_connections;`
- `reserved` — everything that is not an API instance and still needs to
  connect: `superuser_reserved_connections` (usually 3), a migration running
  during a deploy, a backup job, `psql` in someone's terminal, the platform's
  own monitoring. Ten is a defensible floor on a small deployment.
- `api_instances` — the *maximum* the platform may run, not today's count.
  During a rolling deploy both the old and the new set are connected at once,
  so a deploy is when this budget is actually spent.

Worked example, small Render deployment: `max_connections = 97`, reserve 10,
2 API instances that briefly become 4 mid-deploy → `(97 - 10) / 4 ≈ 21`. Set
`DATABASE_CONNECTION_LIMIT=20` and a rolling deploy still fits.

That arithmetic gives an upper bound. There is also a floor, and it is
sharper than the ceiling.

A purchase confirmation holds its connection for the whole of a
multi-round-trip transaction, so the pool size governs how many
confirmations an instance can have in flight at once. Measured on the
development container: at concurrency 8 against a pool of 9, the path runs
at 75.6 confirmations a second with no failures; at concurrency 16 against
that same pool, it manages 0.7 a second and fails 25 of 32 requests. One
step past the pool size takes the platform's main money path from healthy to
94% errors — there is no gradual degradation in between.

**The pool must exceed peak concurrency, not merely equal it.** A
confirmation needs connections outside its transaction as well as inside —
it reads the intent, resolves the referral chain, and writes an audit record
— so a pool sized exactly to the worker count starves: measured at pool 40
with 40 concurrent confirmations, 119 of 120 failed, while the same
concurrency against a pool of 64 ran clean at 65.7/s. The same starvation
reappeared at pool 64 with 64 workers. Whatever headroom you choose, verify
it at your own peak rather than assuming it.

The ratio that worked here — a pool about 1.5× peak concurrency — is an
**observation from one benchmark on one machine, not an invariant**. It has
no theoretical backing, it was not tuned, and it will move with the shape of
your traffic and the number of round-trips a settlement makes. Treat it as a
starting point to measure from.

`DATABASE_CONNECTION_LIMIT=40` is likewise **a staging configuration, not a
universal production value**. It was chosen for the staging deployment and
verified healthy there at concurrency 8, 16 and 32; it is not a
recommendation for any other deployment, and it is not a ceiling the
platform grows into safely on its own.

So `DATABASE_CONNECTION_LIMIT` has to satisfy both constraints at once: high
enough to clear the peak concurrent confirmations one instance will see with
headroom, and low enough that every instance's pool together — counting the
old and new sets during a rolling deploy — fits inside `max_connections`.
When those two cannot both hold, the answer is more instances or a
connection pooler in front of PostgreSQL, never the smaller pool: that
failure mode is an outage on the busiest path rather than a slow one. The
numbers and the method are in
[LOAD_TEST.md](LOAD_TEST.md#the-purchase-path-and-the-cliff--30-august-2026).

`DATABASE_POOL_TIMEOUT` (seconds) is the companion setting: how long a query
waits for a free connection before failing. Raising it hides pool exhaustion
as latency; lowering it turns it into fast, visible errors. Leave it alone
unless there is a reason.

Two related facts worth knowing:

- an interactive transaction holds its connection for its whole duration, so
  the money paths — which are transactional by design — are what actually
  consumes the pool under load;
- `prisma migrate deploy` opens its own connection and takes an advisory
  lock. It is part of `reserved`, not of the API's share.


## 1. What production refuses to run without

`NODE_ENV` has three real values: `development` (a laptop), `staging` (a real
deployment, reachable over the network, that has not signed a commercial
contract yet), and `production`. The guards below split along that line —
some care whether a human can reach the server over the network, others care
whether the server can move real money or send a real SMS — and staging
answers those two questions differently.

**Guards that apply to `staging` and `production` alike** — reachability, not
commerce:

| Requirement | Enforced by | Why it is not a warning |
|---|---|---|
| `CORS_ORIGINS` | `main.ts` | An unset value used to mean "reflect any origin", which with credentials enabled is a fully permissive CORS policy. |
| Swagger UI disabled | `main.ts` | `/docs` documents the entire API surface, including every admin route. Fine on a laptop; not fine on a URL anyone can guess. |
| Refresh cookie `Secure` flag | `refresh-cookie.ts` | A cookie sent over plain HTTP is interceptable on the network path. `staging` is a real network hop even without a production contract behind it. |

**Guards that stay `production`-only** — a rehearsal environment legitimately
has none of these yet, and gating them the same way would make staging
undeployable rather than safe:

| Requirement | Enforced by | Why it is not a warning |
|---|---|---|
| A real acquirer | `PaymentsModule` | A sandbox adapter approves every charge. In production that is a platform that reports money it never took. |
| An SMS carrier (`SMS_ENDPOINT`) | `SmsModule` | A verification code written to stdout is indistinguishable from one that was delivered — until a real user is locked out by it. |
| Push delivery (`PUSH_ENABLED=true`) | `PushModule` | Nobody reports a notification they never knew was coming, so a silently disabled channel stays broken indefinitely. |
| `REDIS_URL` | `RedisModule` | The variable has a `redis://localhost:6379` default so local dev never needs an env file — the same default in production would silently point advisory locks and the sweep queue at an empty local instance instead of the real shared one. Added 2026-08-16, launch-readiness pass. |

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are validated at 32 characters
minimum by `env.validation.ts` in every environment. **In `production`
specifically** (security hardening, 2026-08-23), the process additionally
refuses to start if either secret matches a known placeholder pattern
(`change-me-*`, `example`, `your-secret`, `insecure`, `test-secret`, and
similar — see `PLACEHOLDER_SECRET_PATTERNS` in `env.validation.ts`), is
low-entropy (fewer than 8 distinct characters — catches a repeated or
cyclic value that happens to be 32+ characters long; 8 rather than
something closer to a hex secret's 16-symbol alphabet, because a 20,000-
sample check of genuinely random hex strings found real ones occasionally
landing as low as 9 distinct characters by chance — see the comment on
`hasLowEntropy` in `env.validation.ts`), or is identical to
the other secret. This closed a real gap: before this guard, the exact
`.env.example` values — `change-me-access-secret-min-32-chars-long` and its
refresh counterpart, both 32+ characters — passed the length-only check and
would have let `NODE_ENV=production` boot on secrets anyone can read in this
repository, a total authentication bypass (anyone who knows or guesses the
secret can mint access/refresh tokens for any user, role, or partner scope).
Generate real ones with `openssl rand -hex 32` — two separate invocations,
one for each secret.

**`TRUST_PROXY` does not block boot, but matters as much as `CORS_ORIGINS`
does for any deployment that sits behind a real reverse proxy or load
balancer.** Security/financial hardening pass, 2026-08-19 (GitHub issue #28):
a live pentest found rate limiting on login/OTP/password-reset fully
bypassable by spoofing a rotating `X-Forwarded-For` header, because `main.ts`
used to trust a bare hop count (`app.set('trust proxy', 1)`) unconditionally
with no real proxy in front of it to have stripped that header first. Left
unset (the default), `req.ip` is the real TCP peer address — correct and safe
with no proxy in front, but if this deployment *does* put a reverse proxy or
load balancer in front of the API, every client behind it will otherwise
appear to rate-limit as one shared address. Set it to that proxy's IP/CIDR
(or one of Express's named subnets — `loopback`, `linklocal`, `uniquelocal`)
once the proxy is confirmed to strip any inbound `X-Forwarded-For` before
appending its own. See `.env.example` and `apps/api/src/config/trust-proxy.ts`
for the full reasoning — never set this to a bare hop count.

So the first production deploy is blocked on commercial decisions — an
acquirer contract, a carrier account, an Expo project — not on engineering.
Until those exist, run the rehearsal environment with `NODE_ENV=staging` (not
`development` — see above) and a real `CORS_ORIGINS`; that gets CORS
enforcement, no exposed Swagger UI, and a `Secure` refresh cookie without
requiring a live carrier or acquirer. `NODE_ENV=development` is for a
developer's own machine only.

---

## 1a. Network / firewall requirements — Postgres and Redis

Security hardening (2026-08-23). Neither Postgres nor Redis should ever be
reachable from the public internet in production — only `tutak-api` (and,
for Postgres, whatever runs backups/migrations) needs to reach them, and
both hold data or capabilities that a stolen password alone should not be
enough to get to from anywhere in the world: Redis has no network-layer
access control beyond its one shared `--requirepass` value, and Postgres's
own password can be brute-forced or leaked far more easily than "also has to
already be on the private network."

**What this repository ships:**

- `docker-compose.yml` is documented at the top of this file as a **local**
  stack, and its own comments say so again at the Postgres/Redis blocks —
  but nothing enforced that until this pass. Their `ports:` mappings are now
  bound to `127.0.0.1` explicitly (`"127.0.0.1:5432:5432"`,
  `"127.0.0.1:6379:6379"`) rather than left unqualified, which used to
  publish both to every interface on the host, including whatever network
  the host itself is on. Local development is unaffected — `psql -h
  localhost` and every tool on the host machine itself still connects
  exactly as before.
- `render.yaml`'s Redis (`type: keyvalue`) already set `ipAllowList: []`,
  which Render documents as blocking every external connection while
  same-region services (`tutak-api`) still reach it over Render's internal
  network. Its Postgres (`databases:`) did **not** have the same setting —
  Render's own documented default for an omitted `ipAllowList` is "reachable
  from any IP with valid credentials," i.e. publicly exposed to a
  password-guessing/brute-force attempt from anywhere on the internet. Fixed
  in this pass by adding the same `ipAllowList: []` to the `tutak-db` entry.
- `railway.json` declares only the API service's build/deploy behaviour; it
  does not provision Postgres or Redis at all. A Railway deployment adds
  those as separate managed plugins/services through Railway's own console
  or `railway.toml`, which this repository does not define — see "What this
  does not (and cannot) cover" below.
- No `docker-compose.prod.yml`, Kubernetes manifest, Terraform, or other
  production-specific infrastructure-as-code file exists in this repository
  (`infra/docker/` is present but empty). Production is documented, not
  templated: §8 below and the environment-variable reference in §4 are what
  a self-managed deployment follows by hand.

**If you self-host Postgres/Redis (rather than a managed provider) for a
real deployment**, beyond what any file here can enforce:

- Do not publish 5432/6379 to a public interface at all — no `-p
  5432:5432` / `-p 6379:6379` on a host with a public IP, whether run via
  Docker or bare-metal. Bind to the container network or `127.0.0.1` only,
  and let `tutak-api` reach them over that private path (Docker's internal
  DNS between services in one Compose/Swarm/Kubernetes network, or the cloud
  provider's VPC).
- If the database host is unavoidably reachable on a public IP (a cloud VM
  with no VPC peering to the API host), put a firewall/security-group rule
  in front of it that allows inbound 5432/6379 **only** from the API
  server's own IP (or its NAT gateway/VPC CIDR) — never `0.0.0.0/0`. AWS
  security groups, GCP firewall rules, and every major cloud's equivalent
  all support source-IP/CIDR restriction on a per-port basis for exactly
  this.
- Managed instances remain the right default regardless (§8.1) — a managed
  provider's private networking is one setting away, rather than a firewall
  rule an operator has to remember to write and keep correct as
  infrastructure changes.

**What this does not (and cannot) cover.** Nothing in this repository can
enforce a cloud firewall, security group, or VPC configuration that lives
outside it — those are provisioned by whoever stands up the actual hosting,
not by application code or a compose file. This section documents the
requirement; verifying `nmap` or the provider's own network console shows
5432/6379 closed to the public internet on the actual production host is
an operational step for whoever runs that deployment, the same way rotating
`SEED_ADMIN_PASSWORD` after first boot (§8.5) is.

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

**First production launch must start from a clean database.** Two
migrations added nullable, unbackfilled columns/tables for refund
attribution (`20260817010000_purchase_intent_pool_snapshot`,
`20260817070000_refund_attribution_tracking`) — independent audit, GitHub
issue #28. This repository has never carried real customer financial data
(no production launch has happened yet, per
`docs/LAUNCH_READINESS_2026-08-16.md`), so no backfill was built: it would
be speculative and unprovable rather than a real reconstruction. If any
`PurchaseIntent` row is ever confirmed before running these migrations,
`PurchaseIntentRefundService` now fails closed (an explicit 500, not a
silent zero-effect refund) rather than guessing at its pool split — the
fix is to launch, and take every subsequent backup, only from a database
whose migration history includes both of the above from the start.

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
ACCOUNT_DELETION_GRACE_DAYS=30      # see §7a
RETENTION_NOTIFICATION_DAYS=90      # see §7b — none of these are legal advice
RETENTION_SESSION_DAYS=90
RETENTION_CHALLENGE_DAYS=30
RETENTION_QR_CODE_DAYS=90
RETENTION_IDEMPOTENCY_DAYS=180
RETENTION_OUTBOX_DAYS=90
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

### Encryption

Set `BACKUP_AGE_RECIPIENT` to an [age](https://age-encryption.org) public key
and every dump is encrypted as it is written; the plaintext is shredded, not
just unlinked. `BACKUP_GPG_RECIPIENT` does the same through gpg if that is
what your organisation already uses. Without either, the script still runs
and prints a warning — the dump contains every phone number and every
password hash on the platform, in a file whose whole purpose is to be copied
somewhere else.

Public-key on purpose: the machine taking backups holds only the key that can
*write* them. Somebody who takes that machine gets tomorrow's backups and not
yesterday's.

```
BACKUP_AGE_RECIPIENT=age1...        # public key; the private key lives elsewhere
```

**Decide who holds the private key before you need it.** An encrypted backup
whose key nobody can find is indistinguishable from no backup at all, and you
find that out on the worst day. Rehearse the restore with the real key, from
the machine that would actually do it:

```
age --decrypt -i <private-key> backups/tutak-<stamp>.dump.age > restored.dump
./scripts/restore.sh --verify restored.dump
```

### What the scripts do not do

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

## 7c. Point-in-time recovery

A nightly dump loses up to a day. PITR loses seconds, and it is the only
mechanism that answers the question an incident actually asks: *put the
database back to 14:52, just before the bad migration ran.*

**If you are on a managed Postgres — RDS, Cloud SQL, Neon, Supabase — turn
their PITR on and stop reading here.** It is a checkbox, it is continuously
tested by the provider, and it does not need any of the scripts below. This
section is for a self-hosted cluster, which is what `docker-compose.yml`
describes.

### How the pieces fit

PITR is two things that are useless separately:

| | what it is | taken by |
| --- | --- | --- |
| **Base backup** | a physical copy of the cluster's files | `scripts/pitr-basebackup.sh` |
| **WAL archive** | every change since, segment by segment | `scripts/pitr-archive.sh`, called by Postgres |

Recovery unpacks a base and replays WAL on top of it up to the moment you
name. Note that `backup.sh`'s `pg_dump` **cannot** serve as the base: a dump
is a logical export with no blocks for WAL to replay onto. Keep both — they
fail in different ways, and the second mechanism is what you reach for when
the first cannot be restored.

### Turning it on

`docker-compose.yml` already does this. On a cluster you manage yourself:

```conf
# postgresql.conf
archive_mode = on
archive_command = '/usr/local/bin/tutak-pitr-archive.sh "%p" "%f"'
wal_level = replica            # the default; never lower it to `minimal`
```

```conf
# /etc/tutak/pitr.env — readable by the postgres user
PITR_ARCHIVE_DIR=/var/lib/tutak/wal-archive
BACKUP_AGE_RECIPIENT=age1...   # optional, and see the warning below
```

Restart, then take the first base backup — **in that order**. A base taken
before archiving is on can only ever restore to the instant it was taken;
`pitr-basebackup.sh` refuses to run in that state rather than hand you a
backup with that hidden in it.

```bash
./scripts/pitr-basebackup.sh /mnt/backups/base
```

Schedule it weekly. Between base backups the archive is what covers you, so
the base cadence sets how much WAL must be replayed during a recovery, not
how much data you can lose.

### Recovering

```bash
./scripts/pitr-restore.sh \
  --base /mnt/backups/base/base-20260809T031500Z \
  --target '2026-08-09T14:52:07Z' \
  --into /var/lib/tutak/recovered
```

It recovers into a **separate** data directory and starts it on a
**separate** port (5433 by default). It never writes to the live database.
That is deliberate: you get one attempt at choosing the target time, and
choosing it wrong after overwriting production leaves nothing to try again
from. Recover alongside, read both, then decide.

Aim slightly *before* the damage. `recovery_target_inclusive` defaults to on,
so a target equal to the bad transaction's commit time replays it.

### Rehearse it, on a schedule

```bash
./scripts/pitr-rehearse.sh
```

The drill writes rows, takes a base, writes more rows, records a safe point,
destroys the rows, recovers to the safe point in a second cluster, and
asserts that the post-base rows came back and the post-accident row did not.
It works on a table it creates for the purpose — nothing real is at risk —
and it fails loudly if `pg_stat_archiver.failed_count` is anything but zero.

Run it after any change to the archive location, the backup schedule, the
Postgres version, or the machine holding the backups. Those four are what
break a chain that worked last month.

**Rehearsing found a real trap.** On Debian and Ubuntu, `postgresql.conf`,
`pg_hba.conf` and `pg_ident.conf` live in `/etc/postgresql/<ver>/<cluster>/`,
*not* in the data directory — so a perfectly good `pg_basebackup` unpacks
into a cluster that will not start, with only `could not access the server
configuration file` to explain itself. `pitr-restore.sh` now writes a minimal
config when the base has none. Discovering that during a real 03:00 incident
would have cost the time it takes to work out what is missing.

### Two things to watch

- **A failing `archive_command` is an outage on a timer.** Postgres keeps
  retrying and holds the segment in `pg_wal`, so the disk fills rather than
  the data being lost — which is the right trade, and still an outage.
  Monitor `pg_stat_archiver.last_failed_time` and alert on it.
- **Encrypt, and then make sure you can decrypt.** The WAL carries the rows
  themselves; encrypting the nightly dump while leaving the archive in the
  clear protects yesterday and publishes today. Set `BACKUP_AGE_RECIPIENT`
  and rehearse with the real private key from the machine that would do the
  restoring. Note that the stock `postgres:*-alpine` image has no `age`
  binary — encrypting in-container means building an image that carries one.
  An encrypted archive whose key nobody can find is indistinguishable from
  no archive.

### Pruning

Never delete WAL newer than the oldest base backup you still intend to use;
that base becomes unrestorable the moment you do. `pitr-basebackup.sh`
deliberately does not touch the archive for this reason. `pg_archivecleanup`
does it correctly when you point it at the `START_WAL` of your oldest live
base:

```bash
pg_archivecleanup /var/lib/tutak/wal-archive "$(cat /mnt/backups/base/base-<oldest>/START_WAL)"
```

## 7a. Account deletion

Both app stores require an in-app way to delete an account, and Google Play
additionally requires a **public web page** explaining it that works without
installing anything. Ship `public/account-deletion.html` at a stable URL —
`https://tutak.am/account-deletion` or equivalent — and give Google Play that
URL in the Data safety form. It is a single self-contained file with no
external requests, so any static host will do; nothing about it depends on
this repository being deployed.

The deletion itself happens in two stages, and the split is the part worth
understanding before answering a regulator about it:

| | When | What |
| --- | --- | --- |
| Stage 1 | The instant the customer confirms | `deletedAt` set, every session revoked, every device and push token removed. They cannot sign in again. |
| Stage 2 | `ACCOUNT_DELETION_GRACE_DAYS` later | Phone, email, name and password overwritten; notifications and spent credentials deleted; remaining loyalty points retired through the normal expiry path. |

The gap is not hesitation. A refund or a card chargeback can arrive days after
a purchase and has to post against a wallet whose owner row still exists, and
a customer who deleted by mistake needs a window in which support can restore
them — impossible once the phone number is gone. Thirty days covers both.
Shortening it below your acquirer's chargeback window will produce refunds
that cannot be settled.

The user row is never deleted. Payments, transactions, ledger postings and
audit entries reference it by foreign key; removing it would either break
those references or take the accounting record with them. After stage 2 the
row survives with nothing on it that names a person, which is what both the
accounting rules and the privacy rules actually ask for.

Accounts holding a partner or administrative role are refused by the endpoint
— deleting one would orphan a business or remove the last operator. Those go
through support, after the role is transferred.

The sweep that performs stage 2 is `account.anonymize-deleted`, hourly. If it
stops, the heartbeat in §5a alerts within four hours.

---

## 7b. Retention

`retention.prune` runs nightly at 04:00 Yerevan and deletes non-financial
records past their period: read notifications, dead sessions, spent
verification codes, redeemed QR codes, completed idempotency records and
processed outbox rows. Unread notifications, live sessions, in-flight
idempotency keys and unprocessed outbox rows are never touched — each of
those exclusions is load-bearing, and each has a test asserting it.

**Nothing financial is pruned, ever.** Transactions, payments, refunds,
settlements, payouts, ledger accounts and postings, bonus lots and the bonus
ledger are outside this sweep's reach by construction. So are audit logs — a
trail with a hole in it is not a trail — and fraud signals, which exist to
recognise a pattern repeating.

The default periods are engineering judgements about what the code needs, not
legal advice. They are configurable because the final numbers should come
from a lawyer who knows which regime applies to you. If you shorten
`RETENTION_IDEMPOTENCY_DAYS` below your clients' retry horizon, a retried
request will execute a second payment.

---

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

### This has now actually been run

Until August 2026 the paragraphs above were a design claim: the sweeps were
*built* to tolerate more than one instance and had only ever run on one. Two
API processes were booted against a single Postgres and a single Redis and
driven with real traffic. What was observed:

| Check | Result |
| --- | --- |
| Both instances healthy, zero errors in either log across the whole run | ✅ |
| Recurring schedule after both booted and both upserted it | 10 jobs, not 20 |
| Sweep heartbeat rows | one row per job, shared |
| A token minted by instance A, presented to instance B | accepted |
| Same idempotency key sent to both **simultaneously** | A captured, B refused with 409 "already in progress" |
| Same idempotency key sent to B **after A finished** | returned A's payment id — no second charge |
| 51 captured payments split across both instances | 51 `payment.captured` ledger transactions, and **zero** payments with any other count |
| Duplicate settlements per partner and period | none |
| Outbox after the run | fully drained, 0 unprocessed |
| Double-entry invariant | debit 127,710.0000 = credit 127,710.0000, difference exactly 0 |

The one-to-one column is the one that matters. Two workers competing for the
same outbox rows produced exactly one ledger transaction per payment — which
is what `FOR UPDATE SKIP LOCKED` is for, now demonstrated rather than
assumed.

**What this does not prove.** Both instances were on one machine, so the
network between them was loopback: no partition, no clock skew, no
cross-availability-zone latency. Postgres and Redis were each a single
instance — this exercised two *application* replicas, not a database
failover. And the run lasted minutes, not days.

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
