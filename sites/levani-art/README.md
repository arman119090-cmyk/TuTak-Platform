# LEVANI ART — website

Private art gallery site for **LEVANI ART** (ART · ELEGANCE · DECOR):
paintings, sculpture, fountains and decorative objects, in six languages.

Next.js 16 (App Router) · TypeScript · plain CSS · no UI framework.
Every public page is statically generated; only the enquiry page and its API
run on the server.

This folder is a self-contained project that happens to live in the TuTak
repository. It has its own `package.json`, lockfile and `pnpm-workspace.yaml`,
and is not part of the TuTak workspace — it can be moved into its own
repository as is.

## Local setup

```bash
cd sites/levani-art
pnpm install
cp .env.example .env.local   # optional for development
pnpm dev                     # http://localhost:3000 → redirects to /en (or your browser language)
```

Node ≥ 20.9, pnpm 10.

## Checks

```bash
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint
pnpm test          # vitest: locale negotiation, enquiry validation, rate limit,
                   # catalog integrity (no invented facts), dictionaries, search
pnpm build         # image variants + production build (185 static pages)
pnpm e2e           # Playwright against the production build, desktop 1440 + phone 390
```

`pnpm e2e` starts `pnpm start` itself (or reuses a server on :3100). Run
`pnpm build` first.

## Structure

```
src/
  app/[locale]/…          routes: home, collection(/[category]), artworks/[slug],
                          artists, about, private-clients, enquire, privacy, terms
  app/api/enquiry         enquiry endpoint (validation, honeypot, rate limit)
  app/sitemap.ts, robots.ts
  proxy.ts                locale redirect (cookie → Accept-Language → English)
  i18n/config.ts          ← the one place for locale behaviour
  i18n/dictionaries/*.ts  all interface text, typed: a missing key is a type error
  content/                data layer — catalog, artists, site facts & switches
  components/             Header, LanguageSelector, Emblem, SearchOverlay, …
public/artworks           product photography (WebP)
public/brand              logo reference crops
```

## Content

- `src/content/catalog.source.json` is the owner's catalog, verbatim.
  `catalog.ts` maps it to the typed `Artwork` model. Unknown facts are `null`
  and are never rendered.
- To add a fact (material, year, provenance…), set it on the artwork in
  `catalog.ts`. The detail page shows it automatically.
- **Prices**: `price: null` shows "Price on request". Set
  `{ amount, currency }` and the detail page formats it; no component changes.
  Structured data never includes a price.
- `src/content/site.ts` holds contact details, social links and company facts
  (all `null` now) and the switches for private-client audiences and advisory
  services (advisory is off until the owner confirms each service).
- Artists: `src/content/artists.ts`. Only names are known.
- A CMS later: replace the functions in `catalog.ts` / `artists.ts` with
  fetches that return the same types.

## Languages

`hy`, `ru`, `it`, `de`, `fr`, `en` under `/{locale}/…`. First visit follows the
browser language, otherwise English; a manual choice is remembered in the
`LEVANI_LOCALE` cookie. Switch detection or persistence off in
`src/i18n/config.ts`.

The selector shows a heraldic emblem and a small caret; hover or keyboard
focus reveals the native language name; click/tap opens the list (bottom sheet
on phones). The emblems are the official state arms (`public/emblems/*.webp`,
rendered from the SVGs of the `coat-of-arms` npm package, MIT); France, which
has no coat of arms, uses its de facto state emblem, English uses the Royal
Coat of Arms of the United Kingdom. See `components/Emblem.tsx`.

## Enquiries

The form posts to `/api/enquiry`, which validates, applies a honeypot, a
minimum fill time and a per-IP rate limit (5 per 10 min, in memory), then
hands the enquiry to `deliverEnquiry()` in `src/lib/enquiry-transport.ts` —
**the single integration point**. Set `ENQUIRY_TRANSPORT=webhook` and
`ENQUIRY_WEBHOOK_URL` to deliver to a CRM, Zapier/Make or an email relay.
Until then the API answers 503 and the form tells the visitor online
enquiries are not connected — it never pretends to have sent.

Notes for production:
- The rate limiter is per process; with several instances use Redis/KV.
- The client IP comes from `x-forwarded-for`. Behind a proxy that does not
  overwrite that header, a client can spoof it.
- A captcha can be added in `verifyCaptcha()` (Turnstile/hCaptcha).

## Deployment

Any Node host that runs `next start` (Render, Railway, Vercel, a VPS):

```
root directory:  sites/levani-art
build command:   pnpm install --frozen-lockfile && pnpm build
start command:   pnpm start          # honours $PORT
env:             NEXT_PUBLIC_SITE_URL, ENQUIRY_TRANSPORT, ENQUIRY_WEBHOOK_URL
```

`NEXT_PUBLIC_SITE_URL` is read at build time for canonical/hreflang/sitemap —
rebuild after changing it.

## Images

Photography is ~709 px wide (crops from Instagram screenshots). Layouts never
stretch it beyond roughly its native size.

There is **no runtime image optimizer**. `pnpm build` (and `pnpm dev`) first
runs `scripts/build-images.mjs`, which writes every width next/image can ask
for to `public/artworks/_w/<width>/` (git-ignored); a custom loader
(`src/lib/image-loader.ts`) points `srcset` at those static files. Reason: in
Next 16.3.6 a request aborted while the built-in `/_next/image` optimizer is
cold leaves that URL hanging for all later visitors until a restart
(reproduced; see `docs/OTCHET_2026-09-24_LEVANI_ART_GOTOVNOST.md` in the
repository root).

To replace a photograph: overwrite the file in `public/artworks` (same name),
update its size in `catalog.ts` (`pnpm test` checks it), rebuild.
