# Little Joe Armenia

Online store for Little Joe car fragrances in Armenia. Prices are in AMD. The site has four locales: Armenian `hy` (default), Russian `ru`, Italian `it` and English `en`. It is a single Next.js app with a PostgreSQL database and a back office at `/admin`. This folder is self-contained, so it can be moved to its own repository (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#splitting-this-folder-into-its-own-repository)).

**Status:** demo-ready, not launch-ready. The seeded catalogue is placeholder data. Online payments run in a sandbox, and several merchant contracts and data deliveries are still missing. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) and [docs/EXTERNAL_DEPENDENCIES.md](docs/EXTERNAL_DEPENDENCIES.md).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Actions, `src/proxy.ts`), React 19 |
| Language | TypeScript, strict |
| Database | PostgreSQL through Prisma 7 (`prisma-client` generator → `src/generated/prisma`, `@prisma/adapter-pg`) |
| Styling | Tailwind CSS 4, with tokens in `src/app/globals.css` |
| Forms / validation | react-hook-form + zod 4 (the same schemas run on client and server) |
| Motion | `motion/react`, used in two components only (see [docs/DESIGN.md](docs/DESIGN.md#motion)) |
| Storage | Local disk (dev) or S3-compatible storage (`aws4fetch`), see `src/lib/storage/index.ts` |
| Tests | Vitest (unit + integration), Playwright (e2e) |
| Hosting | Render free plan (`render.yaml`) |

## Quick start (local)

Requirements: Node ≥ 22, pnpm 10 (`corepack enable`) and a local PostgreSQL.

```bash
# 1. Database (any Postgres ≥ 14; the defaults below match .env.example)
createuser -s lj && psql -c "ALTER USER lj PASSWORD 'lj'"   # or use your own credentials
createdb -O lj lj

# 2. Config
cp .env.example .env            # set SESSION_SECRET (≥32 chars) and ADMIN_EMAIL / ADMIN_PASSWORD (≥12 chars)

# 3. Install, migrate, seed, run
pnpm install                    # also runs `prisma generate`
pnpm db:migrate                 # prisma migrate deploy
pnpm db:seed:demo               # reference data + demo catalogue + first admin
pnpm dev                        # http://localhost:3000 → redirects to /hy
```

With the default `.env.example` you get `DEMO_MODE=true` (demo products and a demo banner), `PAYMENTS_MODE=mock` (sandbox for Idram/Telcell/card) and `AUTH_CODE_DELIVERY=console` (customer sign-in codes are printed to the server log).

### Demo admin login

`prisma/seed.ts` (`bootstrapAdmin`) creates one `OWNER` from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. It only does this when no admin with that email exists yet, and the password must have at least 12 characters. Open `http://localhost:3000/admin/login` and sign in with those values.

The seed never changes an existing admin. To add more admins or reset a password:

```bash
pnpm admin:create -- --email manager@example.com --name "Manager" --role MANAGER        # prompts for the password
ADMIN_PASSWORD='new-long-password' pnpm admin:create -- --email owner@example.com --name Owner --role OWNER --update
```

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Next dev server |
| `pnpm build` | `prisma generate && next build` |
| `pnpm start` | `next start` |
| `pnpm start:render` | Render start command: `prisma migrate deploy`, then the idempotent seed, then `next start -p $PORT` |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `prisma generate && tsc --noEmit` |
| `pnpm test` | Unit tests (`tests/unit`) |
| `pnpm test:integration` | Migrates `TEST_DATABASE_URL`, then runs `tests/integration` |
| `pnpm test:e2e` | Playwright (`tests/e2e`) against a running app |
| `pnpm i18n:check` | Checks the translation keys, empty strings and placeholders; also checks DB content when a database is reachable |
| `pnpm db:migrate` | `prisma migrate deploy` |
| `pnpm db:migrate:dev` | `prisma migrate dev` (writes new migrations) |
| `pnpm db:seed` | Reference data + first admin (production-safe; with `SEED_DEMO=true` it also seeds the demo catalogue) |
| `pnpm db:seed:demo` | Same, with `SEED_DEMO=true` |
| `pnpm admin:create` | Create or re-activate a back-office user (`scripts/create-admin.ts`) |
| `pnpm catalog:import -- file.json [--dry-run]` | JSON catalogue import (`scripts/import-catalog.ts`; format in `prisma/seed-data/import-template.json`). New products are created as DRAFT. A value that differs from a VERIFIED fact goes to the import-review queue instead of being written |

## Tests

```bash
pnpm test                                   # unit: pure logic, no DB

# integration: needs a real Postgres database whose name contains "_test"
createdb -O lj lj_test
pnpm test:integration                       # uses TEST_DATABASE_URL or postgresql://lj:lj@localhost:5432/lj_test
```

Integration tests truncate every table between tests (`tests/support/db.ts`). `resetDb()` refuses to run unless the URL looks like a test database. Files run one at a time (`fileParallelism: false` in `vitest.config.ts`).

E2E tests need a running, seeded app in demo configuration:

```bash
DEMO_MODE=true PAYMENTS_MODE=mock AUTH_CODE_DELIVERY=screen pnpm db:seed:demo
DEMO_MODE=true PAYMENTS_MODE=mock AUTH_CODE_DELIVERY=screen pnpm build && \
DEMO_MODE=true PAYMENTS_MODE=mock AUTH_CODE_DELIVERY=screen pnpm start &
pnpm exec playwright install chromium       # first time only
pnpm test:e2e                               # BASE_URL defaults to http://localhost:3000
```

Playwright runs two projects, `mobile` (Pixel 7) and `desktop` (1440×900), with one worker (`playwright.config.ts`).

## Documentation

| File | Topic |
|---|---|
| [SECURITY.md](SECURITY.md) | Threat model, controls, known gaps, how to report a vulnerability |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, request flow, i18n, SEO, checkout, orders, payments, inventory, analytics |
| [docs/DESIGN.md](docs/DESIGN.md) | Visual system, tokens, components, accessibility |
| [docs/PRODUCT_MODEL.md](docs/PRODUCT_MODEL.md) | Data model: manufacturer facts vs Armenia commercial data, provenance rules |
| [docs/PRODUCT_DATA_SOURCES.md](docs/PRODUCT_DATA_SOURCES.md) | Where every seeded value came from, and what is unverified |
| [docs/ASSETS.md](docs/ASSETS.md) | Replacing placeholder images with authorised photography |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Render free blueprint, demo → production switch, backups |
| [docs/EXTERNAL_DEPENDENCIES.md](docs/EXTERNAL_DEPENDENCIES.md) | Credentials, contracts and data the owner still has to supply |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phases and honest status |
