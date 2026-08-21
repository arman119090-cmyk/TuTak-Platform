# TuTak v2 — Claude read-first delivery

This is the entry point for the mobile-app redesign. Do **not** begin from a single preview image or recreate the UI from memory.

## Required reading and viewing order

1. `docs/TUTAK_MASTER_PROJECT_CONTEXT_2026-08-16.md` — product/financial facts.
2. `docs/NEXT_CLAUDE_TASK.md` — the already-approved 3-level referral engine and its economics.
3. `docs/design/TUTAK_UI_UX_MASTER_SPEC_V2.md` — the full visual and behaviour specification.
4. Open the vector boards at 100% zoom:
   - `docs/design/TUTAK_V2_DESIGN_PREVIEW.svg` — Home, Map, QR, Wallet;
   - `docs/design/TUTAK_V2_REFERRAL_PREVIEW.svg` — Referral Network;
   - `docs/design/TUTAK_V2_COMPONENT_SHEET.svg` — components, labels, states and navigation.
5. Compare against the associated PNGs — high-resolution rendered review copies.
6. Read `docs/design/TUTAK_V2_COMPONENT_INVENTORY.md`, then `docs/design/TUTAK_V2_CLAUDE_TASK.md`.

## Exact deliverables to implement

- shared light visual system and components based on existing `packages/design` tokens;
- Home, Map/Explore, QR/PurchaseIntent, Wallet, Profile and **Referral Network**;
- direct Home entry to `Моя сеть` / `Пригласить друзей` before long transaction history;
- HD Home Jako hero at `docs/design/assets/tutak-home-hero-parrot-v2.jpg`, UI text rendered by the app;
- referral hierarchy: personally invited Level-1 list; aggregate count only for Levels 2 and 3;
- loading, empty, error, long-text and narrow-screen states.

## Absolute constraints

- The visual direction does not authorise changes to money/discount logic, QR/PurchaseIntent state machine, partner settlement, EV/OCPI or database structure.
- The 3-level referral engine is an approved separate/queued product task. If working on it, follow `docs/NEXT_CLAUDE_TASK.md` exactly. The client must not calculate tiers or rewards.
- Do not expose indirect referral identities or their relationship graph. Levels 2 and 3 are counts only.
- Do not use competitor screenshots, arbitrary web images or AI images as partner branding/media. Only TuTak-owned art and official/licensed partner assets belong in the product.
- Never call a discount balance cash or promise withdrawal.

## Visual acceptance gate

Before opening a merge-ready PR, capture and compare updated screenshots at 360dp Android and 390pt iPhone widths for Home, Map, QR/PurchaseIntent, Wallet and Referrals. Confirm Russian, Armenian and English copy; large AMD values; keyboard safety; and all empty/loading/error states. Dark mode is not part of this delivery unless separately requested.

If a required API response has not yet landed, show a truthful unavailable/loading state and document the gap in the PR. Do not add fictional figures, people, partner photos, availability or reward calculations.
