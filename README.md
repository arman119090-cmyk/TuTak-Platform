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
docker-compose.yml   Local Postgres + Redis for development
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model, the
bonus engine's design, module boundaries, and the production-readiness
roadmap (what's real today vs. what a millions-of-users launch still needs).

## Prerequisites

- Node.js 20+
- pnpm 10 (`corepack enable` will pick up the pinned version automatically)
- Docker (for local Postgres/Redis) — or point `DATABASE_URL`/`REDIS_URL` at
  managed instances

## Getting started

```bash
pnpm install

# Start local Postgres + Redis
docker compose up -d

# Configure the API
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env if you changed the docker-compose credentials/ports

pnpm --filter @tutak/api prisma:generate
pnpm --filter @tutak/api prisma:migrate
pnpm --filter @tutak/api prisma:seed   # creates roles/permissions + a super-admin

pnpm --filter @tutak/api dev            # http://localhost:4000/v1, docs at /docs
```

The seeded super-admin logs in with phone `+37400000000` / password
`ChangeMe123!` — change this immediately in any non-throwaway environment.

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

Edit `apps/mobile/app.json` → `expo.extra.apiBaseUrl` to point at your API
(defaults to `http://localhost:4000/v1`; use your machine's LAN IP when
testing on a physical device).

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

## A note on this environment

The Docker Compose stack (Postgres/Redis) could not be pulled and verified
inside the sandbox this was built in — the sandbox's egress policy blocks
Docker Hub's registry CDN. Everything was instead verified at the strongest
level available: the Prisma schema loads and generates a client cleanly, and
the full backend, mobile app, and both dashboards each typecheck/build with
zero errors. Run `docker compose up -d` in a normal environment before
`prisma:migrate`.
