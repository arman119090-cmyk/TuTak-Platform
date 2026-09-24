# Content still needed from the owner

Nothing below is invented on the site; each item is `null` or a placeholder
until supplied.

## Business facts (`src/content/site.ts`)
- [x] Phone for WhatsApp / Viber / Telegram: +374 33 228 733 (given 24.09 as 033228733; Armenian format assumed).
- [ ] Email, address.
- [x] Instagram: linked to https://www.instagram.com/levani__art/ (the account the supplied screenshots come from). Remove in `site.ts` if wrong.
- [ ] Legal name, registration number, year founded (About page makes no claim).
- [ ] Which advisory services are actually offered (all switched off).
- [ ] Confirm the five private-client audiences may be shown (all on; worded as invitations, not as services).

## Enquiries
- [ ] Destination for enquiries: email / CRM → an endpoint for `NEXT_PUBLIC_ENQUIRY_ENDPOINT` (until then enquiries go to Instagram).
- [ ] Final production domain for `NEXT_PUBLIC_SITE_URL`.

## Legal
- [ ] Privacy notice text — LEGAL REVIEW REQUIRED (draft, `noindex`).
- [ ] Terms of use text — LEGAL REVIEW REQUIRED (draft, `noindex`).

## Catalog (`src/content/catalog.ts`) — per artwork
- [ ] Material (none confirmed — titles say "Bronze" for three pieces, but the field stays empty).
- [ ] Year, origin, provenance, condition, availability, indoor/outdoor.
- [ ] Dimensions for: Majestic Elephant, Imperial Malachite Pedestal, Timeless Elegance Clock, Egyptian Queen, Sea Turtle Fountain, Lion & Serpent, Golden City Bridge, Bronze Bear & Cub, Old Town Street.
- [ ] Artists of the 16 unattributed works (if known and documented).
- [ ] Descriptions (optional, per language).
- [ ] Prices, if they are ever to be shown.
- [ ] Higher-resolution photographs (current files are ~709 px crops from screenshots; Sea Turtle is only partly visible in the source).

## Artists (`src/content/artists.ts`)
- [ ] David Davidyan, Édouard Delabrière: life dates, country, biography, exhibitions — only if documented.

## Brand
- [ ] Vector (SVG) or transparent PNG logo — the current files are raster crops from a social-media screenshot.
- [ ] Confirm the brand spelling "LEVANI ART" (as on the emblem).

## Language flags
- [x] 24.09: the owner asked to replace the coats of arms with flags. The selector shows flags only (Armenia, Russia, Italy, Germany, France, United Kingdom for English).

## Translations
- [ ] Native review of Armenian (`hy.ts`) before launch; ideally also ru/it/de/fr.
