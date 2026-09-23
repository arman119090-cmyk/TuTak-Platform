# Deployment (Render, free plan)

The target is **Render's free plan only**. Everything below works without a paid add-on.

## Blueprint

`render.yaml` in this folder defines:

| Resource | Settings |
|---|---|
| Database `little-joe-db` | PostgreSQL, `plan: free`, database `little_joe`, user `little_joe`, `ipAllowList: []` (no external access) |
| Web service `little-joe-armenia` | Node, `plan: free`, `region: frankfurt`, `rootDir: little-joe-armenia` |
| Build | `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build` |
| Start | `pnpm start:render`, which runs `prisma migrate deploy && tsx prisma/seed.ts && next start -p $PORT` |
| Health check | `/api/health` (runs `SELECT 1`) |

Steps:

1. Render dashboard → **New → Blueprint** → connect the repository.
2. **Blueprint file path: `little-joe-armenia/render.yaml`**. The blueprint is not at the repository root; if this folder has been split into its own repository, see [below](#splitting-this-folder-into-its-own-repository).
3. Enter the `sync: false` values when prompted: `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12 characters or more). The seed creates this OWNER on first boot.
4. Deploy. The first request after deploy (or after sleep) can take about a minute.

## Free-tier constraints and how the app handles them

| Constraint | Consequence | Handling in this project |
|---|---|---|
| The web service sleeps after about 15 minutes idle | Cold start of about a minute | Nothing to configure. Expect a slow first page |
| The free Postgres **expires 30 days after creation** unless upgraded | Data loss | Take a `pg_dump` before day 30 (see [Backups](#backups)) |
| No pre-deploy command | Migrations cannot run separately | `start:render` migrates and seeds on every start. The seed is idempotent and never overwrites admin edits |
| No cron jobs | Reservation expiry cannot be scheduled on Render | It runs lazily on every checkout and admin request. An external cron is optional (see below) |
| Ephemeral filesystem | `public/uploads` disappears on redeploy or restart | Use `STORAGE_DRIVER=s3` (Cloudflare R2 or any S3-compatible store) or add images by external `https://` URL |
| About 512 MB RAM | — | scrypt is tuned to use about 32 MiB (`src/lib/security/password.ts`) |

The limits in this table are Render's published free-tier behaviour at the time of writing. Check render.com/docs/free before relying on them.

## Environment variables

Set by the blueprint:

| Variable | Value |
|---|---|
| `NODE_VERSION`, `NODE_ENV` | `22`, `production` |
| `DATABASE_URL` | From the database |
| `SESSION_SECRET`, `MOCK_PAYMENT_SECRET`, `CRON_SECRET` | Generated |
| `DEMO_MODE`, `SEED_DEMO`, `PAYMENTS_MODE`, `AUTH_CODE_DELIVERY`, `BRAND_AUTHORIZED` | `true`, `true`, `mock`, `screen`, `false` (demo) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Entered in the dashboard |

Optional, set in the dashboard (full list in `.env.example`):

| Variable | When |
|---|---|
| `APP_URL` | For a custom domain. It defaults to `RENDER_EXTERNAL_URL`, and all canonical URLs, the sitemap and payment return URLs use it |
| `STORE_NAME` | Default "Little Joe Armenia" |
| `IDRAM_REC_ACCOUNT`, `IDRAM_SECRET_KEY`, `IDRAM_PAYMENT_URL` | Idram merchant |
| `TELCELL_*`, `CARD_ACQUIRER_*` | Stored only. These adapters are not implemented |
| `RESEND_API_KEY`, `EMAIL_FROM` | Required when `AUTH_CODE_DELIVERY=resend` |
| `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` | Media |
| `RESERVATION_TTL_MINUTES` | 5–1440, default 30 |
| `GOOGLE_SITE_VERIFICATION` | Search Console |

Analytics IDs (GA4, Meta, TikTok) are set in `/admin/settings`, not in env.

`src/lib/env.ts` validates env at first use and **refuses to start** with unsafe combinations (see [SECURITY.md](../SECURITY.md#secrets)).

## Switching demo → production

1. **Use a fresh database.** This is strongly recommended because the seed never overwrites existing rows. A demo database keeps:
   - the demo delivery prices;
   - Idram, Telcell and card enabled;
   - the **demo promo codes `WELCOME10` and `MINUS500`**, which stay usable on the live site.

   If you keep the demo database, deactivate or delete these in admin, and archive the demo products.
2. Set env:
   - `DEMO_MODE=false`: hides `isDemo` products and the demo banner, and makes robots.txt allow indexing.
   - `SEED_DEMO=false`.
   - `PAYMENTS_MODE=live`: only COD plus configured, implemented adapters are offered. Today that means COD and, with credentials, Idram.
   - `AUTH_CODE_DELIVERY=resend`, with `RESEND_API_KEY` and `EMAIL_FROM`. `screen` is refused without demo mode. Phone sign-in stays unavailable because there is no SMS gateway.
   - `APP_URL=https://<your-domain>`.
   - `BRAND_AUTHORIZED` stays `false` until Drive Int. AG's authorisation is documented. Once it is, set it `true` **and** tick "brand authorisation confirmed" in `/admin/settings` (business). Both are required for "authorised" wording.
3. In `/admin/settings`:
   - set real **delivery methods** (prices, free-from thresholds, regions, ETA). Without a demo seed they are created inactive at 0 AMD;
   - enable the payment methods;
   - fill in contacts, social links, business legal name and tax ID, the SEO suffix and OG image, and the analytics IDs.
4. Create the real catalogue (see [PRODUCT_DATA_SOURCES.md](PRODUCT_DATA_SOURCES.md)), and have a lawyer review the legal pages.
5. Before going live with Idram, verify the adapter against Idram's documentation and run a real test payment (see [EXTERNAL_DEPENDENCIES.md](EXTERNAL_DEPENDENCIES.md)). The callback URL to register with Idram is `https://<domain>/api/payments/callback/idram`.

## Backups

The free Postgres is deleted after 30 days. Export it before then, and regularly after launch:

```bash
# Render dashboard → little-joe-db → Connect → External connection string
pg_dump --format=custom --no-owner --no-acl "$EXTERNAL_DATABASE_URL" -f little-joe-$(date +%F).dump
# restore into a new database
pg_restore --no-owner --no-acl -d "$NEW_DATABASE_URL" little-joe-YYYY-MM-DD.dump
```

`ipAllowList: []` blocks external connections. Temporarily allow your IP in the database settings to run `pg_dump`, then remove it again. After restoring into a new database, update the service's `DATABASE_URL`. Images on S3/R2 are not in the dump; back up the bucket separately.

## Custom domain

1. Render → service → Settings → Custom Domains → add `shop.example.am` (and/or the apex) and create the DNS records Render shows. Render issues TLS.
2. Set `APP_URL=https://shop.example.am` and redeploy. Canonical URLs, hreflang, the sitemap, JSON-LD and payment return and callback URLs all derive from it.
3. Update the callback URL at the payment provider, and the Search Console property.

## Optional free external cron

Expired reservations are already swept lazily. To release stock even when nobody checks out, call the endpoint from a free scheduler. For example, a GitHub Actions workflow in the repository that hosts this app:

```yaml
# .github/workflows/expire-reservations.yml
name: expire-reservations
on:
  schedule: [{ cron: "*/15 * * * *" }]
  workflow_dispatch: {}
jobs:
  call:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "${{ secrets.APP_URL }}/api/cron/expire" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

Copy `CRON_SECRET` from the Render dashboard into the repository secrets. The endpoint returns `{"failed":n,"cancelled":m}` or 401. It also wakes the sleeping service, which uses free instance hours.

## Splitting this folder into its own repository

The folder has no references outside itself. To move it with history:

```bash
# from the root of the current repository
git subtree split --prefix=little-joe-armenia -b little-joe-armenia-split
git push git@github.com:<owner>/little-joe-armenia.git little-joe-armenia-split:main
```

In the new repository:
- delete `rootDir: little-joe-armenia` from `render.yaml`, or set it to `.`;
- use `render.yaml` as the Blueprint path;
- move any workflow such as the cron above to `.github/workflows/`.
