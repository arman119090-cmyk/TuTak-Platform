# TuTak — UI Preview

Every image below was rendered from the implemented code running against a
live PostgreSQL + Redis + API stack. Nothing here is a mockup, a wireframe or
a hand-drawn comp — the numbers, balances, tokens and timestamps are real
records created through the public API.

**Captured:** 26 screens · mobile at 390×844 @3x, dashboards at 1440×900 @2x.

Reproduce with:

```bash
./scripts/dev-setup.sh
pnpm --filter @tutak/api dev & pnpm --filter @tutak/admin dev & pnpm --filter @tutak/partner dev &
node tools/preview/seed-demo.mjs          # creates the demo records
node tools/preview/build-mobile.mjs       # bundles the mobile harness
node tools/preview/shoot-web.mjs "$(cat creds.json)"
node tools/preview/shoot-mobile.mjs "$(cat creds.json)"
```

---

## How these were rendered

**Dashboards** — genuinely end-to-end. Playwright signs in through the real
login form, the session is a real JWT, and every table is populated by the
running API. No stubs of any kind.

**Mobile** — this container has no iOS/Android emulator, so the screens are
mounted through **react-native-web** in `tools/preview/mobile`. The harness
imports the *unmodified* screen components from `apps/mobile/src`, wraps them
in the app's own providers (ThemeProvider, i18n, react-query,
SafeAreaProvider), and points the real API client at the running backend —
so the data is live. Four native-only modules are stubbed because they have
no browser equivalent: `expo-secure-store`, `expo-localization`,
`expo-constants` and `expo-camera`. **No application code was changed to
produce these.**

The one visible consequence: on the scanner screen the camera feed renders as
a black surface. Everything drawn over it — reticle, copy, safe-area layout —
is the real implementation.

---

## Mobile app

### Splash → Auth

| Splash | Login | Registration |
|---|---|---|
| ![Splash](screenshots/mobile-01-splash.png) | ![Login](screenshots/mobile-02-login.png) | ![Registration](screenshots/mobile-03-register.png) |

Jako appears once, at the top, as the mark. The `+374` prefix is baked into
the field so the customer only types the eight digits that vary.

### Home & Wallet

| Home | Wallet / bonus balance |
|---|---|
| ![Home](screenshots/mobile-04-home.png) | ![Wallet](screenshots/mobile-05-wallet.png) |

The balance card is the hero: available balance set very large, the three
bonus states rendered as one proportional bar, and Jako behind it as a 7%
watermark. Here 10 300 points are available and 2 701.15 are still pending —
you can read that split before reading either number.

The wallet screen adds lifetime totals and an "expiring soon" list ordered by
soonest expiry, which is the only ordering that makes bonus lots useful.

### Payments

| My QR code | Scanner |
|---|---|
| ![My QR](screenshots/mobile-06-my-qr.png) | ![Scanner](screenshots/mobile-07-scan-qr.png) |

The pay token is live, with a real countdown against its actual `expiresAt`,
and the spendable balance is restated so the customer never has to leave the
screen to check it.

### EV charging

| Stations | Charging history |
|---|---|
| ![Stations](screenshots/mobile-08-ev-stations.png) | ![Charging history](screenshots/mobile-09-ev-history.png) |

Connector type, power and price are on the card, so choosing a station takes
no taps. Free/in-use state uses the same green/blue vocabulary as the wallet.

### Activity

| Transactions | Notifications | Referral |
|---|---|---|
| ![Transactions](screenshots/mobile-11-transactions.png) | ![Notifications](screenshots/mobile-12-notifications.png) | ![Referral](screenshots/mobile-10-referral.png) |

Transactions are grouped by day rather than presented as a flat wall of rows.
Unread notifications are marked with a brand dot instead of a tinted card, so
the list stays calm.

### Profile & Settings

![Settings](screenshots/mobile-13-settings.png)

Profile and settings are a single screen in the current implementation:
initials avatar, live language switch across Armenian / Russian / English, and
security entries.

---

## Admin panel

| Sign in | Overview |
|---|---|
| ![Admin login](screenshots/admin-login.png) | ![Admin overview](screenshots/admin-overview.png) |

Platform bonus liability is drawn with the *same* composition bar a customer
sees for their own wallet — an admin and a customer read the identical
picture, which is the point of running one design system.

| Users | Partners |
|---|---|
| ![Users](screenshots/admin-users.png) | ![Partners](screenshots/admin-partners.png) |

| Bonus adjustment | Fraud signals | Audit log |
|---|---|---|
| ![Bonus adjustment](screenshots/admin-bonus-adjustment.png) | ![Fraud signals](screenshots/admin-fraud-signals.png) | ![Audit log](screenshots/admin-audit-log.png) |

The bonus adjustment screen carries a consequence panel that changes with the
direction — a debit consumes oldest-expiring lots first and can never touch
pending or reserved points, and the copy says so before you submit.

---

## Partner dashboard

| Sign in | Overview |
|---|---|
| ![Partner login](screenshots/partner-login.png) | ![Partner overview](screenshots/partner-overview.png) |

| Transactions | EV stations |
|---|---|
| ![Partner transactions](screenshots/partner-transactions.png) | ![Partner EV stations](screenshots/partner-ev-stations.png) |

| Payment QR — idle | Payment QR — live invoice |
|---|---|
| ![QR idle](screenshots/partner-qr-empty.png) | ![QR active](screenshots/partner-qr-active.png) |

Both dashboards share the identical `AppShell`, so someone who works in both
never relearns the furniture — only the subtitle and nav items differ.

---

## Requested screens not in this set

Three items on the review list do not exist as screens in the current build.
Flagging them rather than inventing images:

| Requested | Status |
|---|---|
| **Charging session** (active session UI) | **Not implemented.** The backend fully supports sessions — start, meter values, stop, CDR — and the smoke test exercises them, but the mobile app has no start/stop screen yet. Charging history is the closest existing surface. |
| **Partner page** (in-app partner detail) | **Not implemented in the mobile app.** The Partner *dashboard* is included above. There is no customer-facing partner profile screen. |
| **Profile** separate from Settings | **Merged.** They are one screen in the current implementation, shown above. |

---

## Issues visible in these renders

Recording what the screenshots expose, without changing anything — this pass
was render-only:

1. **`Expires in 14:57s`** on the My QR screen — the `qr.expiresIn` string
   appends a literal `s`, but the screen now passes a preformatted `mm:ss`
   countdown. The suffix should be dropped from all three locales.
2. **AMD symbol clipping** on Home's transaction rows — the `֏` glyph is
   trimmed at the right edge on longer amounts. The value column needs a
   little more room or `numberOfLines` relaxed.
3. **Hard-refreshing a dashboard route bounces to `/login`.** `AuthGate`
   evaluates the session before zustand rehydrates from localStorage, so a
   direct load of e.g. `/users` while signed in redirects. This is why the
   capture script navigates by clicking the sidebar. Worth fixing by gating
   on a hydration flag before redirecting.
4. **Static-QR quiet zone** — the pay matrix is a stylised stand-in, not a
   scannable code (noted in `DESIGN.md`); it is drawn to true QR proportions
   so a real encoder drops in without visual change.
