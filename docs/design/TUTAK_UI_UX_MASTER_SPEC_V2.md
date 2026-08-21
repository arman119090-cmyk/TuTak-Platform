# TuTak UI/UX Master Specification v2

**Status:** design handoff for implementation.  
**Scope:** customer mobile app first; the partner and admin web panels retain the same visual system but are not redesigned in this delivery.  
**Supersedes:** `docs/design/TUTAK_UI_UX_MASTER_SPEC_V1.md` for visual direction where the documents differ. Business rules, API contracts and financial state machines are unchanged.

## What this design is

TuTak is not a generic cashback catalogue. It is a single everyday wallet for:

- a customer’s available discount balance;
- QR purchases with a partner confirmation step;
- EV charging through trusted integrations;
- nearby places and offers;
- referrals and transaction history.

The customer must understand the product in five seconds: **find a place, scan a QR, pay the remainder normally, and use an earned discount safely.**

The visual character is a clean Armenian mobility-and-loyalty product: bright, calm, trustworthy, and mobile-first. The African Grey mascot **Jako** is used as a warm brand signal, never as decoration on every screen.

## Important boundaries

1. The competitor screenshots are reference for information hierarchy only. Do not copy their red colour, exact navigation, auction, gift-card, or bonus-market features.
2. The current approved business model is based on **discounts**, not a freely transferable “bonus currency”. In customer money UI, use `Скидка` / `Доступно для оплаты` / `Зарезервировано`; do not call the balance “деньги” and do not promise cash-out.
3. Do not add an auction, selling bonuses, gift-card marketplace, fuel-card marketplace, or a feature that lacks a backend contract. That would make a beautiful but false product.
4. Partner photos/logos in production must be supplied by the partner or properly licensed. AI images are acceptable only for TuTak-owned generic campaign art, never as a fake representation of a real partner, restaurant, charger or product.

## Navigation and information architecture

Use one fixed bottom navigation with a visually larger central QR action:

| Position | Screen | Main job |
| --- | --- | --- |
| 1 | Home | show available discount, recent activity, one clear next action |
| 2 | Map | find charging stations and partner places nearby |
| 3 | QR | scan/show QR and start a purchase flow |
| 4 | Wallet | explain available, reserved, earned and transaction history |
| 5 | Profile | settings, language, notifications and help |

Offers, categories and partner lists live inside **Map / Explore**, accessible from Home and Map. This is intentionally different from the competitor’s catalogue-first structure: location and immediate use are TuTak’s stronger differentiators.

## Visual direction

### Colour roles

| Token | Value | Use |
| --- | --- | --- |
| `brand-700` | `#0B5D3B` | logo, dark ends of gradients, high-contrast headings on light green |
| `brand-600` | `#00B676` | primary actions, active navigation, available state |
| `brand-100` | `#DCFCE7` | selected chips, quiet success backgrounds |
| `ink-900` | `#172033` | primary text |
| `ink-600` | `#667085` | secondary text |
| `canvas` | `#F7F9F8` | screen background |
| `surface` | `#FFFFFF` | cards and sheets |
| `line` | `#E5E7EB` | dividers and inactive controls |
| `info` | `#2F80ED` | maps, neutral informational states |
| `warning` | `#F59E0B` | time-limited / pending state |
| `danger` | `#E5484D` | rejection, errors and destructive actions only |

Never reuse red for normal navigation or promotions. In the competitor UI it is a brand colour; in TuTak it must keep its meaning as risk/error.

### Type, spacing, shape

- Typeface: **Inter** (with platform-safe system fallback). Armenian, Russian and English must all be tested.
- Base grid: 4 px; layout rhythm: 8 / 12 / 16 / 24 / 32 px.
- Headings: 28 / 24 / 20 px; body: 16 px; supporting labels: 12–14 px.
- Card radius: 20 px; button radius: 16 px; small chips: 12 px.
- Cards use a 1 px quiet border or a very soft shadow, never both heavily.
- Minimum touch target: 44×44 px. Text contrast must meet WCAG AA.

### Brand imagery

- Jako appears on the Home balance card, splash/onboarding, empty states and TuTak-owned campaign cards.
- Use the supplied `tutak-home-hero-parrot-v2.jpg` as the Home hero background. Application text must be layered in the empty left portion; do not burn text into the image.
- The existing vector `packages/design/src/brand/jako.svg` remains the canonical small logo/mark. Do not rasterise it for buttons, navigation, or app icons.
- The screen must still work if every external partner image fails to load: use an initial/logo fallback with a neutral tinted surface.

## Customer screens

### 1. Home

Top: compact Jako mark + `TuTak`, notification icon and profile entry. Do not use a vague greeting as the only identity cue.

Hero balance card:

- primary label: `Доступно для скидки`;
- large formatted AMD amount;
- secondary line: `Зарезервировано: …` only when non-zero;
- a small explanation link: `Как работает скидка?`;
- Jako artwork on the right, screen text on the left.

The primary action is a full-width green `Сканировать QR`. Below it: two equal quick actions, `Начать зарядку` and `Найти партнёра`.

Then show (when data exists): recent operations and one campaign/offer card. Never show invented countdowns, “people are buying”, or balance growth claims.

### 2. Map / Explore

The map is a functional search surface, not a decorative screenshot. Top area: title, search field, filter button and language selector. Filters: `Станции`, `Магазины`, `Кафе`, `Рестораны`, `Ещё`.

- Green lightning pins: EV charging stations; count badge only when live availability data exists.
- Category pins are distinct by icon and accessible label, not colour alone.
- Bottom sheet begins with `Рядом с вами`, contains distance, status and a clear route/details action.
- Tapping a partner opens its detail sheet: official cover photo/logo, address, negotiated discount terms as returned by the server, opening hours if available, and a safe CTA.

### 3. QR and purchase flow

This is the highest-risk UI. It must be deliberately plain and auditable:

1. scan/identify partner;
2. show immutable partner identity;
3. customer enters `Сумма покупки` and requested `Скидка`;
4. show derived `Вы оплатите партнёру: …`;
5. customer creates the request;
6. a 3-minute waiting screen shows `Подтверждение партнёра` and countdown;
7. confirmed, rejected and expired screens come only from server truth.

The QR button is visually central but must not be the sole way to begin a purchase: provide an accessible `Показать мой QR` / `Сканировать QR` text action on its screen.

### 4. Wallet

Show three semantically different values; never merge them:

- `Доступно для скидки` — spendable now;
- `Зарезервировано` — held while a PurchaseIntent is pending, not spendable;
- `Получено всего` — historical/non-spendable metric.

Transaction rows show partner/source, date/time, signed AMD amount, and clear status. A pending/rejected/expired operation must retain its state label.

### 5. Partner card / offer

Use an official partner image at 3:2, with an accessibility-safe gradient overlay only when text is shown on it. A card includes: partner logo, name, location/distance, actual offer/discount wording from the backend and availability. Do not put unreadable white text directly over an unprocessed photo.

### 6. Profile

Language selection, notifications, help/support, legal documents and logout. Settings that have no server capability must not be presented as active controls.

## Partner dashboard and admin panel

Use the same token set, but do **not** copy the mobile navigation. These are operational products:

- Partner dashboard: pending confirmations first, with exact bill, discount, remainder, countdown and confirm/reject confirmation dialog. No silent amount editing.
- Admin: desktop left navigation; information-dense tables with search, filters, IDs, timestamps, status badges and audit trail entry points.
- Financial actions use the brand-green primary only for safe/approved action; rejection/destructive action uses `danger` with a confirmation dialog.

## Asset policy

| Asset | Delivery | Production rule |
| --- | --- | --- |
| Small Jako mark | existing SVG | use canonical vector from `packages/design` |
| Home Jako hero | `assets/tutak-home-hero-parrot-v2.jpg` | text overlay left, crop right, never stretch |
| Partner cover | partner-supplied JPG/WebP, 3:2, ≥1600px wide | license and partner approval required |
| Partner logo | partner-supplied SVG/PNG, 1:1, ≥512px | no AI recreation of trademarks |
| EV station imagery | owner/operator image, ≥1600px wide | do not fake station availability/photo |
| Generic TuTak campaigns | original TuTak-owned 2x/3x art | no text baked into asset when the app can render it |

## Implementation contract for Claude

1. Add only visual assets and presentation changes. Do not alter the financial domain, API contracts, state machine, database or business rules in this task.
2. Reuse `packages/design` tokens and the canonical `Jako` component/SVG. Move repeated values into tokens; do not hard-code competing greens in individual screens.
3. Build the new navigation shell first, then Home, Map, Wallet, QR flow, Partner detail, Profile. Keep existing routes and backend queries intact.
4. Replace every customer-facing “bonus” label with approved discount wording **only where it represents the current discount model**. Do not rename raw internal fields/API enums merely for the UI.
5. Add loading, empty, error, offline/retry, long-text and large-AMD states to each changed screen.
6. Validate on narrow Android (360dp), common iPhone width (390pt), Armenian, Russian and English. The keyboard must not cover amount fields or primary CTAs.
7. Run the existing mobile tests and add presentation tests for: available vs reserved balance visibility, PurchaseIntent pending countdown, partner amount immutability and inaccessible image fallback.

## Definition of done

- All five tabs share one coherent design system and use the navigation above.
- Home, Map, Wallet and QR screens visibly match the attached preview board’s hierarchy, spacing and green/light visual language without copying competitor branding.
- No unsupported marketplace/auction feature appears.
- No fictional partner photo is included as real production data.
- Reserved funds cannot be mistaken for available discounts.
- All existing business flows and API-backed state remain correct.
