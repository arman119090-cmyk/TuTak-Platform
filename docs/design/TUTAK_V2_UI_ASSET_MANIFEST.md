# TuTak v2 — complete UI asset manifest for Claude

Every deliverable below is either an original scalable SVG, an original high-resolution TuTak bitmap, or existing canonical brand source already in the repository. This is the complete customer-mobile visual asset package as of this handoff.

## Direct visual sources

| Asset | Type / quality | Use |
| --- | --- | --- |
| `TUTAK_V2_DESIGN_PREVIEW.svg` | 1800×1520 scalable vector | Home, Map, QR, Wallet composition |
| `TUTAK_V2_REFERRAL_PREVIEW.svg` | 1800×1280 scalable vector | three-level network, Level-1 list, Level-2/3 count-only privacy |
| `TUTAK_V2_COMPONENT_SHEET.svg` | 1800×1220 scalable vector | review of shared controls and cards |
| `assets/tutak-home-hero-parrot-v2.jpg` | 1600×800 original TuTak-owned raster | Home balance card background only |
| `packages/design/src/brand/jako.svg` | canonical scalable vector | small brand mark, never rasterise for UI controls |
| `TUTAK_V2_TOKENS.json` | exact source values | colour, type, grid, radius and component dimensions |

## Individually exported controls

These are visual reference exports, not image buttons to place inside the app. Build accessible native controls from tokens and localized strings; use the SVGs for exact visual comparison.

| Asset | Sample state | Required app behaviour |
| --- | --- | --- |
| `assets/v2/controls/button-primary.svg` | enabled primary | green gradient, 56px high, icon optional, localized label |
| `assets/v2/controls/button-secondary.svg` | enabled secondary | quiet white surface/border, 52px high |
| `assets/v2/controls/button-danger.svg` | destructive | only with confirmation; never standard promotion/navigation |
| `assets/v2/controls/button-icon.svg` | icon-only action | 44px or greater touch target and accessible name |
| `assets/v2/controls/button-disabled.svg` | disabled | disabled only with visible explanation, never a dead unexplained CTA |

## Individually exported bottom-navigation icons

All use `currentColor`: render them with `brand-600` when active and `ink-600`/an accessible inactive token otherwise. They are source vectors, not raster images.

| Asset | Tab |
| --- | --- |
| `assets/v2/icons/nav-home.svg` | Home |
| `assets/v2/icons/nav-map.svg` | Map |
| `assets/v2/icons/nav-qr.svg` | central QR action |
| `assets/v2/icons/nav-wallet.svg` | Wallet |
| `assets/v2/icons/nav-profile.svg` | Profile |

## UI units that must be built as components, not bitmap assets

| Unit | Exact source | Notes |
| --- | --- | --- |
| Bottom navigation | `TUTAK_V2_COMPONENT_SHEET.svg` + `TUTAK_V2_COMPONENT_INVENTORY.md` | Home / Map / central QR / Wallet / Profile; no sixth referral tab |
| Search/filter/chips | component sheet + inventory | text, icon and selected state are all necessary |
| Status pills | component sheet + inventory | state comes only from server, plus text/icon not colour alone |
| Balance card | component sheet + master spec | available/reserved/historical must not merge |
| Map pins/list sheet | master spec + overview SVG | no invented location/availability |
| Referral cards | referral SVG + master spec | Level 1 identities; Levels 2/3 aggregate count only |
| PurchaseIntent screen states | master spec + Claude task | server-confirmed flow and strict three-minute state machine |

## Intentional omissions — do not replace them with AI or placeholders presented as real

- No real partner logo, cover photo, product photo or charging-station photo is supplied in this package, because none was approved/licensed for this handoff. Use the designed neutral fallback until official media is supplied.
- No competitor screenshot is included. It is reference only and contains third-party branding.
- No user/referral photo or personal data is included. The referral visual uses fictional initials solely to define a privacy-safe layout.

## Completeness check before implementation

Claude must compare every changed control to this manifest, open the underlying SVG at 100% zoom, and render its own screenshot at 360dp and 390pt. A control must not ship if it exists only as an approximation from memory.
