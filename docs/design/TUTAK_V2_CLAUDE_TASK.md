# Claude task — implement TuTak mobile design v2

Read first, in this order:

1. `docs/design/TUTAK_UI_UX_MASTER_SPEC_V2.md`
2. `docs/design/TUTAK_V2_DESIGN_PREVIEW.png`
3. `docs/design/README_ASSETS_V2.md`

## Goal

Implement the new **customer mobile-app** visual system shown in the preview. This is a presentation/navigation task. Preserve the current backend contracts, financial rules and state machines.

## Required order

1. Extend/reuse the shared `packages/design` token system; do not hard-code new palette values throughout individual screens.
2. Build the bottom navigation shell: Home, Map, QR, Wallet, Profile. Keep routes/back-navigation correct.
3. Update Home using `docs/design/assets/tutak-home-hero-parrot-v2.jpg` as the balance-card background. Render localized text in the UI; do not bake any UI wording into the image.
4. Update Map / partner discovery: search, categories, map/list sheet and accessible partner cards. Do not add fictional live availability or distance where API data does not exist.
5. Update QR / PurchaseIntent screens without changing their financial behaviour: partner identity, total, requested discount, remainder, strict 3-minute countdown, confirmed/rejected/expired states.
6. Update Wallet so `available`, `reserved` and `historical total` are visually and semantically distinct.
7. Update Profile and support empty/error/loading image states.

## Non-negotiable constraints

- Do not implement auction, selling bonuses, gift cards, fuel cards, or any other competitor-only feature.
- Do not call customer balance cash, money, or withdrawable funds.
- Do not silently permit partner/cashier amount editing.
- Do not make a local optimistic success screen when server confirmation is pending or failed.
- Do not use random web/AI images as real partner media. Use an official partner asset only when supplied; otherwise use the designed fallback.
- Keep Armenian, Russian and English working.
- Do not alter migrations, database schema, API domain rules, monetary arithmetic, or EV/OCPI logic in this task.

## Required verification

- existing mobile test suite still passes;
- add/adjust visual/presentation tests for available vs reserved wallet values and for long localized text;
- test at 360dp Android and 390pt iPhone widths;
- test keyboard focus in amount fields and the primary CTA;
- capture updated screenshots for Home, Map, QR/PurchaseIntent and Wallet under `docs/screenshots/`.

If a screen needs API data that is not available, keep the designed layout but render a truthful disabled/empty state and document the gap. Do not invent an endpoint or a financial rule.
