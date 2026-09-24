# Content still needed from the owner

Nothing below is invented on the site; each item is `null` or a placeholder
until supplied.

## Business facts (`src/content/site.ts`)
- [ ] Email, phone, WhatsApp, address (footer shows "details will be published shortly").
- [ ] Instagram profile URL to link (screenshots show `levani__art` — confirm).
- [ ] Legal name, registration number, year founded (About page makes no claim).
- [ ] Which advisory services are actually offered (all switched off).
- [ ] Confirm the five private-client audiences may be shown (all on; worded as invitations, not as services).

## Enquiries
- [ ] Destination for enquiries: email / CRM / messenger → configure `ENQUIRY_TRANSPORT` + webhook.
- [ ] Final production domain for `NEXT_PUBLIC_SITE_URL`.

## Legal
- [ ] Privacy notice text (placeholder, `noindex`).
- [ ] Terms of use text (placeholder, `noindex`).

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

## Language emblems — decision needed
- [ ] The language selector shows the official state arms of Armenia, Russia, Italy (emblem), Germany, France (de facto emblem — France has no coat of arms) and the Royal Coat of Arms of the UK. Several countries restrict commercial use of state arms (the UK Royal Arms in particular). Confirm with a lawyer before launch.
- [ ] Russia: the file shows the golden double-headed eagle without the red heraldic shield behind it (a widely used official form). Confirm, or ask for the version on the red shield.

## Translations
- [ ] Native review of Armenian (`hy.ts`) before launch; ideally also ru/it/de/fr.
