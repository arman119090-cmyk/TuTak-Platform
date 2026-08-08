# TuTak Platform

TuTak is a loyalty ecosystem for Armenia: QR payments, a bonus-points wallet,
EV charging, a partner network, a referral program, and the admin/partner
tooling to run all of it. This repository is a pnpm/Turborepo monorepo
containing the backend API, the mobile app, and the two web dashboards.

## Repository layout

```
apps/
  api/       NestJS backend — REST API, Prisma/PostgreSQL, Redis
  mobile/    Expo (React Native) app — shared iOS/Android codebase
  admin/     Next.js admin panel
  partner/   Next.js partner dashboard
packages/
  shared-types/  TypeScript enums + DTOs shared by every app
  i18n/          hy/ru/en translation resources shared by every app
docker-compose.yml   Postgres + Redis + api + both dashboards
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model, the
bonus engine's design, module boundaries, and the production-readiness
roadmap (what's real today vs. what a millions-of-users launch still needs).

## Try it: the whole platform in one command

If you want to *use* the thing rather than develop on it, this needs Docker
and nothing else — no Node, no pnpm, no PostgreSQL:

```bash
./scripts/demo-up.sh
```

It generates secrets, builds the API and both dashboards, brings up
Postgres and Redis, applies migrations, and seeds a working dataset —
partners, customers, EV stations, captured card payments, a decline,
settlements, a partial refund, a confirmed payout and two reconciliation
runs (one clean, one with drift). Then it prints the URLs and the logins.

The money is seeded by driving the real engines, not by inserting rows, so
the ledger it produces balances to zero the same way production's would.

- Admin panel — http://localhost:3000
- Partner dashboard — http://localhost:3001
- API + Swagger — http://localhost:4000/v1, http://localhost:4000/docs

`./scripts/demo-down.sh` stops it; `--wipe` also drops the database so the
next start is clean.

**[`docs/TESTING_RU.md`](docs/TESTING_RU.md)** — по-русски: логины, что
смотреть на каждом экране, как подключить мобильное приложение, что делать
если что-то не работает.

**[`docs/LAUNCH_RU.md`](docs/LAUNCH_RU.md)** — по-русски: всё, что нужно
получить, подписать и решить до запуска, в порядке, и куда именно попадает
каждый реквизит.

For a real deployment rather than this one, see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — including the three things the
application deliberately refuses to start without.

## Prerequisites (for development)

- Node.js 20+
- pnpm 10 (`corepack enable` will pick up the pinned version automatically)
- Docker (for local Postgres/Redis) — or point `DATABASE_URL`/`REDIS_URL` at
  managed instances

## Getting started

```bash
pnpm install
./scripts/dev-setup.sh
```

`dev-setup.sh` brings up PostgreSQL and Redis (via Docker Compose when the
daemon is reachable, otherwise using locally-installed servers), writes the
`.env` files if they are missing, then generates the Prisma client, applies
migrations and seeds baseline data. It is idempotent — safe to re-run.

Then start whichever apps you need, each in its own terminal:

```bash
pnpm --filter @tutak/api dev        # http://localhost:4000/v1  (OpenAPI docs at /docs)
pnpm --filter @tutak/admin dev      # http://localhost:3000
pnpm --filter @tutak/partner dev    # http://localhost:3001
pnpm --filter @tutak/mobile start   # Expo — press i / a, or scan the QR code
```

The seeded super-admin logs in with phone `+37400000000` and whatever
`SEED_ADMIN_PASSWORD` was set to when the seed ran — there is no literal
default, because one committed here would be published in these
instructions and never rotated. The account is marked
`mustChangePassword`, so it reaches login and nothing else until it is
rotated through `POST /v1/auth/change-password`.

### Verifying the stack

With the API running:

```bash
./scripts/smoke-test.sh
```

This exercises the real money-moving paths end to end against your database —
registration/login/refresh-token rotation, RBAC, partner onboarding, QR issue
and redemption with a bonus discount, bonus accrual and ledger state,
overspend rejection, idempotent replay, referral qualification, and the
admin/analytics/audit read models — and exits non-zero if anything regresses.

### Doing it manually

If you would rather not use the setup script:

```bash
docker compose up -d                      # or run your own Postgres + Redis
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env.local
cp apps/partner/.env.example apps/partner/.env.local

pnpm --filter @tutak/api prisma:generate
pnpm --filter @tutak/api prisma:deploy    # apply existing migrations
pnpm --filter @tutak/api prisma:seed
```

Use `prisma:migrate` (rather than `prisma:deploy`) only when you have changed
`schema.prisma` and want to author a new migration.

### Web dashboards

```bash
cp apps/admin/.env.example apps/admin/.env.local
cp apps/partner/.env.example apps/partner/.env.local

pnpm --filter @tutak/admin dev     # http://localhost:3000
pnpm --filter @tutak/partner dev   # http://localhost:3001
```

### Mobile app

```bash
pnpm --filter @tutak/mobile start
```

Config is dynamic (`apps/mobile/app.config.js`), not the static `app.json` a
plain Expo template ships with — it reads `API_BASE_URL` from the
environment at build time (falls back to `http://localhost:4000/v1` for
local dev; use your machine's LAN IP when testing on a physical device).
EAS build profiles in `apps/mobile/eas.json` set it per environment
(`development`/`preview`/`production`) — the latter two carry a
`REPLACE_WITH_*_API_URL` placeholder until the API is actually deployed
somewhere reachable.

## Deploying

**[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** is the runbook: required
environment, migrations, health probes, backups, first-deploy order, and the
three things the application deliberately refuses to start without.

The short version of what exists:

- `apps/api/Dockerfile` and the two dashboard Dockerfiles build all three
  images. CI builds them on every commit, boots the whole stack with
  `docker compose`, seeds it, and drives the dashboards through ten
  end-to-end scenarios in a browser — so "it builds" and "it runs" are both
  checked, not assumed.
- The api entrypoint applies pending migrations before serving, so a rolling
  deploy across several instances is safe.
- `GET /health` and `GET /health/ready` are wired for orchestrator probes and
  sit outside API versioning, so a version bump cannot take the health check
  down with it.
- `.github/workflows/docker-publish.yml` pushes the api image to GHCR on
  every push to the default branch and on version tags, using only the
  repository's built-in token.

What is missing is a host to run it on and an acquirer to move money through
— both decisions only the project owner can make.

## Operations

```bash
./scripts/backup.sh                    # compressed dump into ./backups, verified readable
./scripts/restore.sh --verify <dump>   # restore into a scratch DB, check the ledger, drop it
```

The rehearsal is the point: it asserts the restored ledger sums to zero and
that every account still agrees with a replay of its own postings. CI runs
the same rehearsal against the stack it just booted. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §6.

## Monorepo scripts

- `pnpm build` — Turborepo build across every app/package
- `pnpm typecheck` — TypeScript project-references-aware typecheck everywhere
- `pnpm lint` — ESLint everywhere
- `pnpm --filter @tutak/api prisma:migrate` — create/apply a Prisma migration

## Languages

The product ships in Armenian (default), Russian, and English from day one.
UI strings live in `packages/i18n` as a single source of truth consumed by
the mobile app and both dashboards; backend-issued notifications carry
translation keys + params rather than pre-rendered text, so the client
always renders in the user's chosen locale.

## Verification status

The stack has been run end to end against a real PostgreSQL 16 + Redis 7:

- `prisma migrate deploy` reproduces all 27 tables and 21 enums from an empty
  database, and the seed is idempotent.
- The API boots in both watch mode (`nest start --watch`) and from a
  production build (`node dist/main.js`), serving OpenAPI docs at `/docs`.
- `./scripts/smoke-test.sh` — 39 end-to-end assertions covering auth, RBAC,
  the bonus ledger, QR payments, referrals, EV charging, and the admin read
  models — passes with zero server-side errors.
- Both dashboards production-build and serve their routes, with CORS verified
  against the API from `localhost:3000` and `localhost:3001`.
- The mobile app bundles through Metro for both `expo export` (1318 modules →
  a Hermes bytecode bundle) and the `expo start` dev server.

One caveat on Docker specifically: the sandbox this was verified in blocks
Docker Hub's registry CDN, so `docker compose up -d` itself could not be
executed there and PostgreSQL/Redis were run natively instead. The Compose
file is unchanged and standard; `dev-setup.sh` takes the Docker path whenever
the daemon is reachable and falls back to local servers when it is not.
