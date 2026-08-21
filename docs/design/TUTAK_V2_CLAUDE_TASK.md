# Claude task — implement TuTak mobile design v2

Read first, in this order:

1. `docs/design/TUTAK_V2_CLAUDE_READ_FIRST.md`
2. `docs/design/TUTAK_UI_UX_MASTER_SPEC_V2.md`
3. `docs/design/TUTAK_V2_DESIGN_PREVIEW.png`
4. `docs/design/TUTAK_V2_REFERRAL_PREVIEW.svg`
5. `docs/design/TUTAK_V2_COMPONENT_SHEET.svg`
6. `docs/design/TUTAK_V2_UI_ASSET_MANIFEST.md` and `docs/design/assets/v2/`
7. `docs/design/TUTAK_V2_TOKENS.json`
8. `docs/design/TUTAK_V2_COMPONENT_INVENTORY.md`
9. `docs/design/README_ASSETS_V2.md`
10. `docs/NEXT_CLAUDE_TASK.md` — the approved 3-level referral economics and queued engine work

## Goal

Implement the new **customer mobile-app** visual system shown in the preview. This is a presentation/navigation task. Preserve the current backend contracts, financial rules and state machines.

## Required order

1. Extend/reuse the shared `packages/design` token system; do not hard-code new palette values throughout individual screens.
2. Build the bottom navigation shell: Home, Map, QR, Wallet, Profile. Keep routes/back-navigation correct.
3. Update Home using `docs/design/assets/tutak-home-hero-parrot-v2.jpg` as the balance-card background. Render localized text in the UI; do not bake any UI wording into the image.
4. Update Map / partner discovery: search, categories, map/list sheet and accessible partner cards. Do not add fictional live availability or distance where API data does not exist.
5. Update QR / PurchaseIntent screens without changing their financial behaviour: partner identity, total, requested discount, remainder, strict 3-minute countdown, confirmed/rejected/expired states.
6. Update Wallet so `available`, `reserved` and `historical total` are visually and semantically distinct.
7. Make referrals visibly available from Home. Build the `Моя сеть` screen from `TUTAK_V2_REFERRAL_PREVIEW.svg`: share code/link; Level 1 personally invited list; Levels 2 and 3 aggregate counts only; and a separate Referral Challenge / referral-earnings block only when supported by the server.
8. Update Profile and support empty/error/loading image states.

## Non-negotiable constraints

- Do not implement auction, selling bonuses, gift cards, fuel cards, or any other competitor-only feature.
- Do not call customer balance cash, money, or withdrawable funds.
- Do not silently permit partner/cashier amount editing.
- Do not make a local optimistic success screen when server confirmation is pending or failed.
- Do not use random web/AI images as real partner media. Use an official partner asset only when supplied; otherwise use the designed fallback.
- Referral privacy is non-negotiable: show identifiable people only in Level 1, and only as first name + last initial/consented avatar. Levels 2 and 3 may show only counts — no identities, links, tree paths, phone/email, spending or per-person reward data.
- Do not display `0` as an L2/L3 count while the three-level engine/aggregate response is unavailable. Use a truthful loading, unavailable or empty state.
- Keep Armenian, Russian and English working.
- Do not alter referral economics from this design task. If the 3-level engine is being implemented, follow `docs/NEXT_CLAUDE_TASK.md` exactly; the visual layer must consume server truth and never calculate the chain itself.
- Do not alter unrelated migrations, database schema, API domain rules, monetary arithmetic, or EV/OCPI logic in this task.

## Required verification

- existing mobile test suite still passes;
- add/adjust visual/presentation tests for available vs reserved wallet values, the Level-1 identity / Levels-2-and-3 count-only boundary, and long localized text;
- test at 360dp Android and 390pt iPhone widths;
- test keyboard focus in amount fields and the primary CTA;
- capture updated screenshots for Home, Map, QR/PurchaseIntent, Wallet and Referrals under `docs/screenshots/`.

If a screen needs API data that is not available, keep the designed layout but render a truthful disabled/empty state and document the gap. Do not invent an endpoint or a financial rule.
