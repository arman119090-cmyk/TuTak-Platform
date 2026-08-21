# TuTak design assets v2

## Included

- `assets/tutak-home-hero-parrot-v2.jpg` — 1600×800 px, high-quality JPEG, designed for the Home balance-card background. The left side is intentionally clear for app-rendered text; Jako sits at the right.
- `TUTAK_UI_UX_MASTER_SPEC_V2.md` — implementation source of truth for the visual redesign.
- `TUTAK_V2_DESIGN_PREVIEW.svg` / `.png` — static review board, not application code.

## Asset rules

- Keep the original file dimensions; crop with `resizeMode="cover"` / CSS `object-fit: cover` from the right-side subject position.
- Do not put permanent text into the hero artwork. The app must render localized text over it.
- The hero art is TuTak-owned generic brand imagery. It is not a replacement for partner photos.
- Add real partner media to a separate, reviewable manifest that records partner name, source URL/file, approval/licence owner, crop, and last verification date.

## Files intentionally not included

The competitor screenshots and temporary reference uploads are not redistributed in the repository. They are visual references only and may be copyrighted or contain third-party branding.
