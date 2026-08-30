# TuTak Design System

One design system, three surfaces: the mobile app, the partner dashboard and
the admin panel. All of them render the same tokens from
[`packages/design`](../packages/design) — React Native imports them as
TypeScript, the web apps import the generated CSS custom properties. There is
no second copy of the palette anywhere in the repo.

**Two schemes, one system.** The phone is dark-only. The dashboards ship dark
to match it and can be switched to light, because a consumer app opened for
twenty seconds at a checkout counter and a back-office tool someone reads
spreadsheets in for an hour genuinely want different things from a
background — and which one you are doing is not something the code can know.

Both schemes share the spacing grid, the type scale, the bonus-state
semantics and every component contract; only the ground and the accent
differ. On the web the switch is `data-theme` on `<html>`, set by a blocking
inline script in `<head>` before the first paint. That script is not an
optimisation: React sets the attribute after hydration, which is several
hundred milliseconds too late, and the white flash before the dark UI arrives
is the single most common "cheap-looking" tell in a themed web app.

One place where the web scheme deliberately deviates from the phone's: a
mobile card is a translucent pane blurring what is behind it, so `surface` is
an alpha colour. The web has no blur, and that same value renders a card
almost exactly the colour of the page under it — so on the web the canvas
takes the darkest ground and a card takes the step above. The *relationship*
is what carries across, not the literal value.

---

## Principles

**1. Colour is spent only where it carries meaning.**
On the dashboards that means white surfaces with tint reserved for state. On
the phone it means a near-black ground where the single blue→violet gradient
marks the one thing you are meant to act on. Both follow the same rule from
opposite ends: if you are reaching for colour to make something "look
designed", the layout is what needs fixing.

**2. The three bonus states are the brand.**
Green = available, amber = pending, blue = reserved. These hues are reserved
exclusively for bonus state and are never reused as generic UI accents. That
restriction is what makes the colour code learnable: a customer sees the
three-segment bar once on their balance card, and from then on a green dot on
a transaction row — or on an admin's liability chart — is already understood.

**3. Grey is Jako.**
The African Grey is literally a grey bird, so the neutral ramp doubles as the
mascot's palette. Secondary information and the brand mark share a colour
family, which is why Jako can sit inside the interface without competing
with it.

**4. Money is the loudest thing on screen.**
Exactly one display-size number per screen. Everything else recedes. All
numerals are tabular so balances don't shimmy as digits change.

**5. Motion explains, never entertains.**
Under 250 ms, asymmetric easing (fast out, gentle in). The one exception is
the balance bar re-proportioning at 420 ms, because that movement *is* the
information — you should see value travel between states.

---

## Colour

### The phone: premium dark

Defined in [`tokens/premium.ts`](../packages/design/src/tokens/premium.ts).

| Role | Token | Hex |
|---|---|---|
| Ground | `premium.background.base` | `#0A0A0F` |
| Raised surface | `premium.background.tertiary` | `#1C1C24` |
| Card fill | `premium.card.background` | `rgba(20,20,26,0.85)` |
| Glass fill | `glass.background` | `rgba(255,255,255,0.05)` |
| Glass edge | `glass.border` | `rgba(255,255,255,0.10)` |
| Primary | `premium.brand.primary` | `#5B8CFF` |
| Gradient | `gradients.primary` | `#5B8CFF → #A05BFF` |
| Warm gradient | `gradients.secondary` | `#FF6B6B → #FFB347` |
| Primary text | `color.textPrimary` | `#FFFFFF` |
| Secondary text | `color.textSecondary` | `#8E8E93` |

Three rules make it hold together:

- **Depth is a glow, not a shadow.** There is nothing darker than `#0A0A0F`
  to cast a shadow onto, so elevation is blue light spilling outward
  (`glow.sm/md/lg`) rather than grey pooling underneath.
- **Glass needs an edge.** A blur without its 10%-white hairline is a smudge.
  Every pane gets both.
- **The gradient means "act here".** The balance card wears it full-bleed,
  the primary button wears it, the focused pay tab wears it. Nothing else
  does — a second gradient competing for attention is a third of the reason
  dark UIs end up looking cheap.

Both the blur and the glass fill are the same colour on Android, where the
blur is replaced by a flat translucent panel: `expo-blur`'s Android path
repaints every frame and a scrolling list of cards visibly drops frames,
which a user notices and the blur they would not.

### The dashboards: light

Full ramps (25→900) live in
[`tokens/color.ts`](../packages/design/src/tokens/color.ts). Use 500/600 for
fills and icons, **700+ for text on white** (500-level hues do not reach
4.5:1), and 25/50 for tinted surfaces.

| Role | Token | Hex |
|---|---|---|
| Brand | `brand.600` | `#0B5D3B` |
| Available bonus | `available.500` | `#12B76A` |
| Available text | `available.700` | `#027A48` |
| Pending bonus | `pending.500` | `#F79009` |
| Pending text | `pending.700` | `#B54708` |
| Reserved bonus | `reserved.500` | `#2E90FA` |
| Reserved text | `reserved.700` | `#175CD3` |
| Primary text | `neutral.900` | `#101828` |
| Secondary text | `neutral.500` | `#667085` |
| Border | `neutral.200` | `#E4E7EC` |

Red (`danger`) is for destructive actions and failures only. It is never a
bonus state — which is also why Jako's tail carries the brand accent rather
than the species' real red.

### Bonus states across both schemes

The three states keep their identity in both — green available, amber
pending, blue reserved — but the relationships invert on dark. `text` becomes
*lighter* than `fill`, and `surface` is a 12%-alpha wash of the hue with a
28%-alpha border rather than a pale solid tint: a solid light panel would
punch a hole in a dark screen, and a wash without a border dissolves into the
card behind it.

Screens reference **semantic aliases** (`color.availableText`,
`color.textSecondary`) rather than ramp steps, so meaning stays consistent and
one edit re-tunes every surface.

---

## Type

System stack — SF on iOS, Roboto on Android, Segoe/Inter on web. One family,
four weights, tight scale. Large sizes carry negative tracking so they look
set rather than typed.

| Style | Size / line | Use |
|---|---|---|
| `balance` | 56 / 62 | Hero balance. One per screen, at most. |
| `balanceSm` | 30 / 38 | Secondary balance, receipt total. |
| `titleLg` | 26 / 32 | Screen title. |
| `title` | 22 / 30 | Section title. |
| `headline` | 17 / 24 semibold | Row titles, buttons. |
| `body` | 17 / 24 | Default. |
| `bodySm` | 15 / 22 | Supporting copy. |
| `caption` | 13 / 18 | Labels, timestamps. |
| `overline` | 11 / 16 caps | Eyebrows. Sparingly. |

---

## Space, radius, elevation

4pt grid (`space.1` = 4 … `space.12` = 96). Radii are deliberately few:
`sm 8`, `md 12`, `lg 16`, `xl 20`, `2xl 28`, `full`.

Elevation is almost invisible on purpose: depth comes from a hairline border
plus a very soft ambient shadow, never a dark drop shadow. That is what lets
several stacked cards on white still read as one calm surface.

---

## Jako

**Update, 2026-08-23 (Arman's request):** Jako now renders as the actual
logo photo everywhere, not hand-drawn vector art — the section below
describes the superseded illustrated-mark approach and is kept only for the
compositional rules (where he appears, at what opacity) that still hold.

`<Jako />` (`packages/design/src/web/components/Jako.tsx` on web,
the mobile equivalents in `presentation/components/UserAvatar.tsx` /
`PartnerMark.tsx`) renders `/logo-mark.png` (`assets/logo-mark.png` on
mobile) at a given `size`. There is no `brand/jako-paths.ts` vector geometry
file anymore — do not re-add one; swapping in illustrated art later means
changing what these components render, not adding a parallel system.

He appears at most once per screen, in these places:

| Treatment | Where | Why |
|---|---|---|
| **Mark** (`<Jako />`) | Splash, auth header, dashboard sidebar lockup | Identity |
| **Watermark** (`<JakoWatermark />`) | Behind the balance card and referral card, 7% opacity, large and cropped | Makes the card unmistakably TuTak without competing with the number |
| **Empty states** | Any empty list | Warmth on an otherwise blank screen |
| **Success moment** | Payment receipt, 35% opacity | A quiet signature on the one screen worth celebrating |

---

## The balance composition bar

The most important component in the product, and the biggest improvement over
the original design.

TuTak's bonus model has three simultaneous states. Showing them as three
separate pills gives you the numbers but not the *shape* of your balance. The
composition bar renders them as one continuous, proportional bar, so "most of
my points are still pending" is legible in about a quarter of a second —
before a single number is read.

It is the only place all three hues appear together, which is precisely what
teaches the colour code. It appears as:

- `BonusComposition` — mobile, on white (Wallet)
- inside `BalanceCard` — mobile, restyled for the brand-green card (Home)
- `BonusCompositionBar` — web, for platform bonus liability (Admin) and
  issued-vs-redeemed (Partner)

An admin looking at platform liability sees the identical picture a customer
sees of their own wallet. That is the point of running one system.

---

## Components

**Mobile** (`apps/mobile/src/presentation/components`)
`Screen` · `Surface` · `Button` · `TextField` · `ListRow` · `StatePill` ·
`BonusComposition` · `BalanceCard` · `QuickAction` · `SectionHeader` ·
`EmptyState` · `Skeleton` · `Jako`

The dark scheme changed how these look, not what they are: `Surface` became a
glass pane, `Button`'s primary variant took the gradient, `TextField` gained a
focus glow. Names, props and behaviour are unchanged, which is why re-skinning
the entire app touched no screen logic and cost no tests.

One exception is worth knowing about. **The QR code on `MyQrScreen` does not
follow the theme.** Its modules are hardcoded near-black on a hardcoded white
plate, because a QR symbol is specified dark-on-light and plenty of scanners —
including the cheap merchant handhelds that will be pointed at this screen —
refuse an inverted one. Themed, it would have been a beautiful code that does
not scan, failing as a broken payment rather than a broken palette.

**Web** (`packages/design/src/web`)
`AppShell` · `AuthShell` · `Surface` · `Button` · `Field`/`Input`/`Select`/
`Textarea` · `Badge` · `Table`/`Th`/`Td`/`Tr` · `StatTile` ·
`BonusCompositionBar` · `BarList` · `PageHeader` · `EmptyState` · `Jako`

Both dashboards use the *identical* `AppShell`, so someone who works in both
never relearns the furniture — only the subtitle and nav items differ.

Loading always uses skeletons, never spinners, so layout never jumps when data
lands.

---

## Screen inventory

**Mobile (13)** — Splash · Login · Register · Home · Wallet · My QR ·
Scan → Confirm → Receipt · EV stations · EV history · Referral · Transactions ·
Notifications · Settings

**Admin (7)** — Login · Overview · Users · Partners · Bonus adjustments ·
Fraud signals · Audit log

**Partner (5)** — Login · Overview · Transactions · Payment QR · EV stations

---

## Localisation

Every string is a key in [`packages/i18n`](../packages/i18n) with full parity
across Armenian (default), Russian and English — 172 keys, verified equal in
all three. Domain enums (`transactionType.*`, `evStatus.*`, `referralStatus.*`,
`bonusEntryType.*`) are translated too, so no raw `SCREAMING_SNAKE_CASE`
reaches a customer.

Armenian is the longest of the three languages; layouts are built to wrap
rather than truncate.

---

## Accessibility

- Bonus state is **never** carried by colour alone — every state pairs its hue
  with a text label, and the composition bar exposes a combined
  `accessibilityLabel`.
- Text on white uses 700-level hues to clear 4.5:1.
- Minimum touch target 44pt (`layout.minTouchTarget`).
- Focus is always visible and always brand green; never removed.
- `prefers-reduced-motion` is honoured on web.

---

## Known gaps

- **My QR renders a stylised matrix, not a scannable QR code.** Adding a real
  encoder means adding a dependency (`react-native-qrcode-svg`), which is a
  packaging decision rather than a design one. The layout, sizing and quiet
  zone are built to true QR proportions, so swapping the encoder in is a
  one-component change with no visual impact.
- The mark ships as the actual logo photo (see the "Jako" section's
  2026-08-23 update above), not illustrated vector art. If brand later
  commissions a fresh treatment, swap what `<Jako />`/`<JakoWatermark />`
  render; the component API is stable.
- Dark mode is deliberately not implemented — the bonus hues are tuned for
  white surfaces, and re-tuning them for dark is a real design exercise rather
  than an inversion.
