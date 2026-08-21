# Claude task — implement TuTak mobile design v2

Read first, in this order:

1. `docs/design/TUTAK_V2_CLAUDE_READ_FIRST.md`
2. `docs/design/TUTAK_UI_UX_MASTER_SPEC_V2.md`
3. `docs/design/TUTAK_V2_DESIGN_PREVIEW.png`
4. `docs/design/TUTAK_V2_REFERRAL_PREVIEW.svg`
5. `docs/design/TUTAK_V2_COMPONENT_SHEET.svg`
6. `docs/design/TUTAK_V2_JAKO_ICON_SYSTEM.svg`
7. `docs/design/TUTAK_V2_UI_ASSET_MANIFEST.md` and `docs/design/assets/v2/`
8. `docs/design/TUTAK_V2_TOKENS.json`
9. `docs/design/TUTAK_V2_COMPONENT_INVENTORY.md`
10. `docs/design/README_ASSETS_V2.md`
11. `docs/design/TUTAK_V2_MEDIA_SYSTEM_SPEC.md` — authoritative implementation specification for partner logos, customer avatars, approval, privacy and operation snapshots
12. `docs/design/TUTAK_V2_ANDROID_SYSTEM_UI_QA.md` — mandatory safe-area, keyboard, Samsung and light-v2 release gate
13. `docs/NEXT_CLAUDE_TASK.md` — the approved 3-level referral economics and queued engine work

## Goal

Implement the new **customer mobile-app** visual system shown in the preview, including the narrowly scoped media system defined in `TUTAK_V2_MEDIA_SYSTEM_SPEC.md`. Preserve all financial rules and state machines. The media work is deliberately backend-backed: a mock photo or a direct arbitrary image URL is not an implementation. The v2 customer release is light-only and must pass the physical Android system-UI gate; a visually correct canvas that places controls under Samsung system navigation is not an implementation.

## Required order

1. Complete and test the 3-level referral engine from `docs/NEXT_CLAUDE_TASK.md`; it is the already-approved blocking product task. Keep its commits/tests logically separate from visual/media work.
2. Add the media migration, durable storage interface, image validation/derivatives, owner/admin authorisation, audit logging and DTO contracts exactly as specified in `TUTAK_V2_MEDIA_SYSTEM_SPEC.md`.
3. Add partner-logo snapshots to the customer operation flow before rendering the new operation UI. A current directory logo is not a substitute for historical operation identity.
4. Extend/reuse the shared `packages/design` token system; do not hard-code new palette values throughout individual screens. Make light v2 the only release theme: migrate the legacy dark default/persisted value and configure readable system-bar icon contrast before drawing the new shell.
5. Build the bottom navigation shell: Home, Map, QR, Wallet, Profile. Keep routes/back-navigation correct, and meet every insets/keyboard/device requirement in `TUTAK_V2_ANDROID_SYSTEM_UI_QA.md` before accepting a screenshot.
6. Update Home using `docs/design/assets/tutak-home-hero-parrot-v2.jpg` as the balance-card background. Render localized text in the UI; do not bake any UI wording into the image.
7. Update Map / partner discovery: search, categories, map/list sheet and accessible partner cards. Do not add fictional live availability or distance where API data does not exist.
8. Update QR / PurchaseIntent screens without changing their financial behaviour: partner identity, total, requested discount, remainder, strict 3-minute countdown, confirmed/rejected/expired states.
9. Update Wallet so `available`, `reserved` and `historical total` are visually and semantically distinct. Every partner-sourced customer operation must use the reusable partner-brand component and its snapshot.
10. Make referrals visibly available from Home. Build the `Моя сеть` screen from `TUTAK_V2_REFERRAL_PREVIEW.svg`: share code/link; Level 1 personally invited list; Levels 2 and 3 aggregate counts only; and a separate Referral Challenge / referral-earnings block only when supported by the server.
11. Update Profile with the optional customer-avatar upload/replace/remove flow. Support image loading/error/fallback states across the application.

## Non-negotiable constraints

- Do not implement auction, selling bonuses, gift cards, fuel cards, or any other competitor-only feature.
- Do not call customer balance cash, money, or withdrawable funds.
- Do not silently permit partner/cashier amount editing.
- Do not make a local optimistic success screen when server confirmation is pending or failed.
- Do not use random web/AI images as real partner media. Use an official partner asset only when supplied; otherwise use the designed fallback.
- Do not treat a file URL, a client-declared MIME type, or a local production disk as a media implementation. Follow `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` for server validation, durable storage, approval, privacy and immutable operation snapshots.
- Referral privacy is non-negotiable: show identifiable people only in Level 1, and only as first name + last initial/consented avatar. Levels 2 and 3 may show only counts — no identities, links, tree paths, phone/email, spending or per-person reward data.
- Do not display `0` as an L2/L3 count while the three-level engine/aggregate response is unavailable. Use a truthful loading, unavailable or empty state.
- Do not hide Android's gesture pill or three-button navigation to make the app navigation fit. Do not use a guessed device-height constant for an inset. The app's tab labels, icons and central QR action must stay above the real system area in both navigation modes.
- Do not use only a static `layout.tabBarHeight` for bottom clearance after introducing a custom/floating v2 tab bar. Screens, lists, sheets and fixed CTAs must clear its actual rendered height and the live safe-area inset.
- Do not re-introduce an Android keyboard workaround merely because it looks correct in a unit test. `KeyboardAwareScroll` records prior real-device flicker/focus failures; the final solution requires the physical-device proof in `TUTAK_V2_ANDROID_SYSTEM_UI_QA.md`.
- Do not call the visual work complete from cropped mockups, desktop browser screenshots or a simulator-only pass. The Android release evidence must include the real status and bottom system bars.
- Keep Armenian, Russian and English working.
- Do not alter referral economics from this design task. If the 3-level engine is being implemented, follow `docs/NEXT_CLAUDE_TASK.md` exactly; the visual layer must consume server truth and never calculate the chain itself.
- Do not alter unrelated migrations, database schema, API domain rules, monetary arithmetic, or EV/OCPI logic. The media models, authorised upload endpoints and partner-brand snapshot migration explicitly required by `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` are in scope.

## Required verification

- existing mobile test suite still passes;
- add API/authorisation/media tests required by `TUTAK_V2_MEDIA_SYSTEM_SPEC.md`, including unauthorised partner update, invalid upload, avatar-consent and historical-brand-snapshot regression cases;
- add/adjust visual/presentation tests for available vs reserved wallet values, the Level-1 identity / Levels-2-and-3 count-only boundary, and long localized text;
- add a tab-shell safe-area regression test with zero and non-zero Android bottom insets, and prevent a custom v2 bar from reverting to a fixed untested bottom clearance;
- test at 360dp Android and 390pt iPhone widths;
- test keyboard focus in amount fields and the primary CTA;
- complete and record every physical Samsung/Android check in `TUTAK_V2_ANDROID_SYSTEM_UI_QA.md`, including gesture navigation, three-button navigation, keyboard, 130% font scale and QR camera controls;
- capture updated screenshots for Home, Map, QR/PurchaseIntent, Wallet, Profile and Referrals under `docs/screenshots/`; Android evidence must be uncropped and include actual system bars.

If a screen needs API data that is not available, keep the designed layout but render a truthful disabled/empty state and document the gap. Do not invent an endpoint or a financial rule.
