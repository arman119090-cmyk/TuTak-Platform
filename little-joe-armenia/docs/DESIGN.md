# Design system

This page describes what the code does today. The sources of truth are `src/app/globals.css` (tokens, component classes) and `src/components/**`.

## Direction

- **Premium and playful, not automotive.** The page is near-white (`--color-paper: #fbfbf9`) with near-black text. There is no dark theme and no carbon or chrome look. `color-scheme: light` is fixed in `globals.css`.
- **The product and its scent colour take up most of the screen.** Cards, gallery and hero use the product's accent colour as a full-bleed background with the product image on top. Text on a card is limited to collection, name, one descriptor and price (`src/components/product/product-card.tsx`).
- **Large dark surfaces are rare.** The home page has one: the scent-finder call-to-action block (`bg-ink`, `src/app/[locale]/page.tsx`).

## Typography

- **The fonts are self-hosted and licensed under OFL.** The licence files are `public/fonts/OFL-*.txt`. Nothing is loaded from Google Fonts. The CSP `font-src 'self'` would block that anyway.
- **One family name, `LJ Sans`, combines two fonts through `unicode-range`:**
  - Manrope variable (weights 200–800): the Latin, Latin-ext, Cyrillic and Cyrillic-ext subsets. It covers `en`, `it` and `ru`.
  - Noto Sans Armenian: static 400/500/600/700 files. The 700 file is also mapped to 800. It covers `U+0530-058F` and a few punctuation marks.

  Because of this, mixed text such as "Little Joe" inside an Armenian sentence picks the right font glyph by glyph.
- **A metric fallback prevents layout shift while fonts load.** `LJ Fallback` is local Arial with `size-adjust: 104%`, `ascent-override: 96%`, `descent-override: 27%` and `line-gap-override: 0%`. Font stack: `"LJ Sans", "LJ Fallback", system-ui, sans-serif`.
- **All faces use `font-display: swap`.** Fonts get `Cache-Control: public, max-age=31536000, immutable` (`next.config.ts`).
- **Armenian gets its own rules.** `:lang(hy)` resets letter-spacing and uses `overflow-wrap: break-word`. Because Armenian words are long, the display and h1 sizes are smaller in `hy`:
  - `text-display`: `clamp(1.95rem, 1.1rem + 3.9vw, 4.25rem)`, tracking −0.02em
  - `text-h1`: `clamp(1.7rem, 1.25rem + 1.9vw, 2.75rem)`

  `.eyebrow` spacing drops from 0.12em to 0.04em for Armenian.

### Type scale (Tailwind `@theme`)

| Token | Size | Line height | Tracking |
|---|---|---|---|
| `text-display` | `clamp(2.4rem, 1.4rem + 4.2vw, 4.75rem)` | 1.02 | −0.035em |
| `text-h1` | `clamp(1.9rem, 1.4rem + 2vw, 3rem)` | 1.08 | −0.025em |
| `text-h2` | `clamp(1.45rem, 1.2rem + 1vw, 2.1rem)` | 1.15 | −0.02em |
| body | Tailwind defaults (`text-base`, `text-lg`, `text-sm`) | — | — |

Form fields use `font-size: 1rem` so iOS does not zoom on focus.

## Tokens (`src/app/globals.css`)

### Colours

| Token | Value | Use |
|---|---|---|
| `paper` | `#fbfbf9` | Page background, sheets |
| `card` | `#ffffff` | Cards, fields, footer |
| `ink` | `#111111` | Text, primary button |
| `ink-2` | `#3d3d3a` | Secondary text |
| `muted` | `#6b6a65` | Captions, eyebrow |
| `line` | `#e8e7e2` | Hairlines |
| `line-strong` | `#d4d2cb` | Field and ghost-button outlines |
| `mist` | `#f3f2ee` | Neutral fills (empty states, bars) |
| `ok` | `#1e7a4a` | In stock, verified purchase |
| `warn` | `#9a5b00` | Low stock, DEMO price label |
| `bad` | `#b3261e` | Errors, sold out |
| `focus` | `#2457ff` | Focus ring |

### Radii, easing, shadow

| Token | Value |
|---|---|
| `--radius-card` | `1.25rem` |
| `--radius-pill` | `999px` (buttons, chips) |
| Fields | `0.875rem` |
| Gallery / hero image | `1.75rem` / `2.25rem` (inline in the components) |
| `--ease-out-soft` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--shadow-float` | `0 1px 2px rgb(17 17 17 / .04), 0 12px 32px -12px rgb(17 17 17 / .18)` |

### Spacing and layout

- **The container is `container-lj`:** max width 88rem, side padding 1rem (under 48rem), 2rem (48rem and up) or 3rem (90rem and up). So the gutter on phones is 16px.
- **Spacing uses Tailwind's 4px scale.** There is no custom spacing token. Sections use `py-8` to `py-24`, and grids use `gap-3` to `gap-10`.
- **`tap` utility:** `min-height`/`min-width` of 2.75rem (44px).

## Dynamic accent

- **The accent comes from the database.** It is stored per entity: `Product.accentColor` + `Product.accentInk`, `Collection.accentColor`, `FragranceFamily.accentColor` and `HomeBlock.accentColor` (`prisma/schema.prisma`). The admin sets it on the product screen (`saveProductAccent`), the collection form and the home blocks. Family accents come only from the seed (`prisma/seed-data/catalog.ts`), because there is no admin screen for families yet.
- **The accent is never guessed.** `toCard()` in `src/lib/catalog.ts` falls back from product to collection to the neutral pair `NEUTRAL_ACCENT #E9E7E1` / `NEUTRAL_INK #111111`. Nothing infers a colour from the product name at runtime.
- **The accent is a UI choice, not a manufacturer fact.** The schema comments say so, and demo accents are recorded as `TASK_BRIEF` or `INTERNAL` in `prisma/seed-data/catalog.ts`.
- **CSS variables carry the accent.** `--accent` / `--accent-ink` are set inline on the product page wrapper. `--accent-soft` and `--accent-wash` are `color-mix()` derivations in `:root`. `::selection` also uses the accent.
- **Colour changes animate through `accent-transition`.** It transitions background, colour and border over 600ms with `--ease-out-soft`.
- **CSP allows inline styles on purpose.** `style-src 'self' 'unsafe-inline'` in `src/proxy.ts` exists for these inline colours. Scripts stay nonce-only.

## Motion

- **`motion/react` is used in exactly two components.** Both read `useReducedMotion()`:
  - `src/components/home/scent-selector.tsx`: the "Choose your Joe" hero selector. The section recolours from the chosen product's accent.
  - `src/components/home/scent-finder.tsx`: finder steps (`AnimatePresence` around each `<fieldset>`).
- **Sheets do not use `motion`.** They animate entrance with CSS keyframes on the native `<dialog>` (`lj-in-right`, `lj-in-left`, `lj-in-bottom`, `lj-fade` in `globals.css`). Exit is instant.
- **Everything else is CSS transitions.** Button press is `scale(.98)`, card image hover is `scale(1.035)` with `motion-reduce:transform-none`, and the sticky buy bar slides in.
- **`prefers-reduced-motion: reduce` switches animation off globally.** `globals.css` sets animation and transition durations to 0.01ms and `scroll-behavior: auto`. The gallery zoom falls back to `motion-reduce:scale-100`.

## Components

| Component | File | Notes |
|---|---|---|
| `.btn`, `.btn-primary`, `.btn-accent`, `.btn-ghost` | `globals.css` | Pill, min-height 3rem, disabled at 45% opacity |
| `.chip` | `globals.css` | Pill toggle, min-height 2.75rem. The active state comes from `aria-pressed` / `aria-checked` / `data-active="true"`, so state and style stay in sync |
| `.field`, `.label` | `globals.css` | `aria-invalid="true"` draws a red ring |
| `.eyebrow` | `globals.css` | Small uppercase label |
| `.prose-lj` | `globals.css` | CMS page body (headings, paragraphs, lists) |
| `Sheet` | `src/components/ui/sheet.tsx` | Native `<dialog>` + `showModal()`: focus trap, Esc, inert background and focus return all come from the browser. Sides: `right` (cart), `left` (mobile menu), `bottom` (mobile filters, gallery zoom). A backdrop click closes it, and the footer pads for `--safe-bottom` |
| `ProductCard` | `src/components/product/product-card.tsx` | 4:5 accent tile, image, New/Bestseller/Sold-out badges, favourite button, `QuickAdd`, price with a DEMO label when `priceIsDemo` |
| `ProductImage` | `src/components/product/product-image.tsx` | Placeholder SVGs are rendered as a plain `<img>`, everything else through `next/image`. Without media it shows an accent-coloured square |
| `Gallery` | `src/components/product/gallery.tsx` | Square main image and thumbnails. Zoom opens a bottom `Sheet` where the pointer pans a 2× image. A "placeholder image" caption appears when `rights ≠ AUTHORIZED` |
| `BuyBox` | `src/components/product/buy-box.tsx` | Price, stock state, variant radio chips, stepper, Add to cart + Buy now. Sticky mobile bar (`md:hidden`) appears once the main CTA scrolls away (IntersectionObserver) |
| `CartDrawer` | `src/components/cart/cart-drawer.tsx` | Right `Sheet`. Cart contents mount only while open, so they are fetched fresh |
| Filters | `src/components/catalog/filters.tsx` | `DesktopFilters`: sticky sidebar from `lg`. `MobileFilters`: bottom `Sheet` below `lg`. `SearchBox` and `SortSelect` write to the URL |
| Header / footer | `src/components/layout/*` | Sticky translucent header, left-sheet mobile menu, language switcher |
| Consent banner | `src/components/analytics/analytics.tsx` | Floating card at the bottom, shown only when an analytics ID is configured |

## Page anatomy

- **Home** (`src/app/[locale]/page.tsx`):
  1. Hero (CMS `HomeBlock` HERO + first featured product on its accent)
  2. "Choose your Joe" selector (when there are 2 or more featured products)
  3. Scent-finder CTA
  4. Bestsellers grid
  5. CMS campaign blocks
  6. "Meet the family" collections (only when more than one collection has products)
  7. Brand story (verified claims only, otherwise an honest empty text)
  8. Approved reviews
  9. Lifestyle images (`AUTHORIZED` rights only; in demo it shows an empty-state text)
- **Catalogue** (`/shop`): H1, then a grid of a 16rem sidebar and results. Above the results: search + mobile filter button + sort. A live result count, then the grid or an empty state. Collection (`/c/[slug]`) and scent family (`/scents/[slug]`) pages reuse the grid.
- **Product page** (`/p/[slug]`): breadcrumb, then two columns (a sticky gallery on desktop). The right column holds collection eyebrow, H1, favourite, rating, family + tags, profile description, `BuyBox`, share/compare, scent profile bars (or a "profile pending" note), and `<details>` sections (facts, how to use, official description, delivery, returns, FAQ). Below: reviews + form, similar scents, and more from the collection.
- **Checkout** (`/checkout`, `src/components/checkout/checkout-form.tsx`): one page with `<fieldset>`/`<legend>` sections (contact, address, delivery, payment) and a sticky summary `<aside>` from `lg`. Online payment starts a redirect or an auto-submitted POST form (Idram). The page redirects to the cart when the cart is empty.

## Accessibility

- **Targets are at least 44px.** `.btn` is 48px, and `.chip`, `tap` and details summaries are 44px or more.
- **Focus is visible.** `:focus-visible` draws a 2.5px `--color-focus` outline with an offset. The skip link in `src/app/[locale]/layout.tsx` jumps to `#main`.
- **The HTML is semantic.** It uses `<header>`, `<main>`, `<footer>`, `<nav aria-label="Breadcrumb">`, `<article>` cards, `<fieldset>`/`<legend>`, `<details>`, `<dl>` for facts and a `<dialog>` for modals.
- **ARIA is used only where native HTML is not enough.** Examples: `role="radiogroup"`/`radio` for variant chips, `aria-live="polite"` on the result count, `role="status"` for cart messages, `aria-current` on gallery thumbnails, and `aria-hidden` on decorative shapes.
- **Each locale sets the page language.** `<html lang>` is `hy-AM` / `ru-AM` / `it-IT` / `en-AM`.
- **Colour is never the only signal.** Stock state is text, and the DEMO price is a text label.

## Responsive and devices

- **The layout targets widths from 320px to 1920px.** The main breakpoints are Tailwind `sm`, `md` (48rem) and `lg`. `next.config.ts` `deviceSizes` go up to 1920.
- **Horizontal overflow is prevented.** `body { overflow-x: clip }`, and the e2e test "no horizontal overflow on key pages" checks it (`tests/e2e/storefront.spec.ts`).
- **iPhone safe areas are partly handled.** The viewport uses `viewportFit: "cover"` and `--safe-bottom: env(safe-area-inset-bottom)`, which pads the footer, sheet footers, the sticky buy bar and the consent banner. **Left, right and top insets are not handled** (landscape notch). This is a known gap.
- **The header stays visible.** It is `sticky top-0`, and `scroll-padding-top: 5rem` keeps anchors clear of it.
