# LEVANI ART — PREMIUM ART GALLERY / E-COMMERCE WEBSITE

## Mission
Build a production-quality, highly premium website for **LEVANI ART**, using the supplied emblem and artwork/product photography. The result must feel like a private luxury gallery and art advisory, not a generic online shop.

The desired emotional language is: **dark elegance, bronze, heritage, museum-grade presentation, private collection, editorial luxury**.

Do not copy another brand’s layout. Inspiration can come from the visual restraint of top auction houses, private galleries and luxury interior publications, but the final design must be original.

---

## 1. Source material

Package contents:
- `assets/logo/` — logo/emblem reference crops.
- `assets/products/webp/` — clean cropped product/art images ready for the web.
- `assets/products/jpg/` — JPG equivalents.
- `assets/source_screenshots/` — untouched Instagram screenshots for fact checking.
- `data/catalog.json` — initial structured catalog.
- `data/locales.json` — supported languages and selector behavior.

The source is Instagram screenshots. **Never include Instagram UI, like counts, captions, buttons or screenshot chrome in the website.**

Do not alter the artwork itself. Do not generate missing areas, change colors, “improve” paintings, change sculptures or fabricate signatures/details.

---

## 2. Brand identity

The supplied emblem visibly says:

**LEVANI ART**

**ART · ELEGANCE · DECOR**

Use **LEVANI ART** as the working brand name unless the owner explicitly changes it later.

The logo crop is a reference asset, not a true vector master. Build the site so the logo can later be replaced with a proper SVG/transparent file without layout changes.

### Visual palette
Use a restrained palette based on:
- near black: `#0B0A09`
- charcoal: `#171411`
- warm ivory: `#F2ECE2`
- antique bronze
- muted gold / champagne
- walnut / deep brown
- stone neutrals

Gold is an accent, not the background of every control.

Avoid:
- fake shiny gold gradients everywhere;
- excessive glow;
- generic Shopify cards;
- large rounded SaaS components;
- neon colors;
- gaming-style animation;
- cluttered badges and discount labels.

### Typography
Use an elegant high-contrast serif for display/headings plus a clean sans serif for UI/body. Suitable directions: Cormorant Garamond / Bodoni Moda + Inter / Manrope, or an equivalent premium pairing.

Typography must be tested for Armenian, Cyrillic, Latin, German accents and French accents. If the primary display font does not cover Armenian well, use a high-quality Armenian-compatible fallback while keeping the hierarchy visually consistent.

---

## 3. Technical foundation

Use a modern production-ready stack:
- Next.js App Router
- TypeScript
- responsive CSS/Tailwind or equivalent component styling
- high-quality motion library only where motion improves the experience
- structured content/data layer separated from components
- image optimization and responsive `srcset`

Do not hardcode all artwork directly into page JSX. Build reusable typed content models.

The implementation must be easy to connect later to a CMS, database, payment system or CRM without redesigning the front end.

---

## 4. Required languages — NON-NEGOTIABLE

The entire public site must support **six languages**:

1. Armenian — `hy` — **Հայերեն** — Armenia coat of arms
2. Russian — `ru` — **Русский** — Russia coat of arms
3. Italian — `it` — **Italiano** — Italy coat of arms
4. German — `de` — **Deutsch** — Germany coat of arms
5. French — `fr` — **Français** — France coat of arms
6. English — `en` — **English** — United Kingdom royal coat of arms for the requested visual treatment

Use locale routes:
- `/hy/...`
- `/ru/...`
- `/it/...`
- `/de/...`
- `/fr/...`
- `/en/...`

Use browser language on first visit if it matches a supported locale. Otherwise fall back to English. Remember the user’s manual choice. Keep this behavior configurable from one place.

Add correct `lang`, canonical URLs and `hreflang` metadata.

### Premium language selector
This is a major design requirement.

**Closed state in the header:**
- show only the current country coat of arms / heraldic emblem;
- next to it show a **very small downward chevron / caret** (`⌄` visual idea, not a large arrow);
- no permanent “Language” text;
- no cheap bordered select box;
- the selector should look integrated into the luxury navigation.

**Desktop hover/focus:**
- gently reveal the current language name in its native form, e.g. `Italiano`, `Deutsch`, `Français`, `English`, `Русский`, `Հայերեն`;
- motion should be subtle: opacity/width/translate, ~150–250 ms;
- show a refined tooltip or label, never a browser-native title popup as the only interaction.

**Opened menu:**
- dark/warm floating panel, subtle border, restrained shadow/backdrop blur;
- each row: coat of arms / heraldic emblem + native language name;
- selected language can use a tiny bronze/gold indicator, not a large checkmark;
- keyboard accessible;
- `Esc` closes;
- click outside closes;
- focus states must be visible but elegant.

**Mobile:**
- tapping the coat of arms opens the same language list in a premium popover/sheet;
- do not rely on hover.

Do not use country flags. Do not use emoji flags. Use refined, visually consistent SVG coat-of-arms / heraldic emblem assets only.

---

## 5. Header / navigation

Desktop header should be almost invisible over hero media at first, then gain a restrained dark/ivory background on scroll.

Suggested navigation:
- Collection
- Paintings
- Sculpture
- Decorative Arts
- Private Clients
- About
- Contact

Right side:
- Search icon
- Enquire / Contact entry
- premium language selector described above

Mobile navigation must be equally polished and not resemble a generic hamburger drawer.

---

## 6. Home page

### Hero
Near/full viewport visual using one of the strongest supplied artworks/sculptures.

Copy direction:
- `LEVANI ART`
- `ART · ELEGANCE · DECOR`
- short editorial line such as: `Curated art, sculpture and timeless objects for exceptional interiors.`

Primary CTA: `Explore Collection`
Secondary CTA: `Private Enquiry`

No visible price.

Use slow, restrained reveal motion. A slight parallax is acceptable if performance remains excellent.

### Featured collection
Avoid a basic 4-column product grid. Use an editorial/asymmetric layout:
- one oversized painting;
- two smaller objects;
- a full-width sculpture moment;
- alternating text/image compositions.

### Categories
- Paintings
- Bronze Sculpture
- Fountains & Garden
- Decorative Arts
- Collectible Objects

### Editorial / philosophy section
Create a calm visual break about collecting, interiors and lasting objects. Keep copy short and premium.

### Private clients CTA
For private collectors, architects, interior designers, hotels/restaurants and luxury residences.

### Footer
Minimal, dark, precise. Include navigation, contact placeholders, social placeholders, legal links and language access. Do not invent address, phone, email or company registration details.

---

## 7. Collection page

Route: `/{locale}/collection`

Filters:
- All
- Paintings
- Sculpture
- Fountains
- Decorative Arts
- Garden
- Collectibles

Architecture should also support future filters:
- Artist
- Material
- Dimensions
- Indoor / Outdoor
- Available / Sold / On request

Do not show numerical prices.

Where commercial intent is needed, use localized equivalent of **Price on request** or simply omit price in collection cards.

Hover treatment should be editorial and quiet: image shift/zoom only a few percent plus `View artwork`.

---

## 8. Artwork / object detail page

Example route:
`/{locale}/artworks/sacred-heights-tatev`

Desktop layout direction:
- ~60–65% visual area for artwork photography;
- information panel on the right;
- generous whitespace;
- sticky details are acceptable if elegant.

Fields supported by the data model:
- title
- subtitle
- artist
- dimensions
- category
- material
- year
- origin
- provenance
- condition
- status
- indoor/outdoor
- description
- delivery notes

**If a value is unknown or null, do not render the field.**

Never invent provenance, artist attribution, authenticity, year, material or certification.

Primary actions:
- `Enquire about this piece`
- `Request private viewing`

No checkout is required in v1 unless explicitly requested later.

---

## 9. Prices

Do **not** put invented premium prices on the site.

For v1:
- catalog cards: no price by default;
- detail page: `Price on request` where appropriate;
- data model: `price: null`.

The architecture must allow real prices to be added later without component changes.

---

## 10. Initial catalog

Build the initial catalog from `data/catalog.json` and supplied photography.

Known works/objects include:

### Paintings
- Sacred Heights — Tatev Monastery Painting — 120 × 93 cm
- David Davidyan — 60 × 45 cm
- Aknuni / Ակնունի — 17 × 24 cm
- Ethereal Grace — Classical Nude Painting — 77 × 30 cm
- Old Town Street Painting — Timeless European Charm
- Golden City Bridge — Elegance Reflected in Light

### Sculpture
- Édouard Delabrière — hunter with dogs composition — 53 × 65 cm visible in source caption
- Bronze Bear & Cub
- Lion & Serpent
- Majestic Elephant
- Imperial Wild Boar — 60 × 100 cm
- Egyptian Queen
- Grace in Bronze — Crane Sculpture — 120 cm

### Fountains / garden
- Eternal Harmony — Classical Fountain Sculpture — 120 cm
- Royal Dominion — Lion Fountain Sculpture — 210 × 130 cm
- Sea Turtle Fountain Sculpture

### Decorative arts
- Timeless Elegance Clock
- Imperial Malachite Pedestal

Use only confirmed facts from the screenshots/data file.

---

## 11. Artists page

Route: `/{locale}/artists`

Support:
- name
- life dates
- country
- biography
- artworks
- exhibitions
- provenance notes

Do not generate fake artist biographies to fill empty space.

---

## 12. About page

Route: `/{locale}/about`

Direction:
**A Collection Beyond Decoration**

Position LEVANI ART as a curated collection of paintings, sculpture and decorative objects for private collections and exceptional interiors.

Do not claim unverified facts such as:
- “founded in 1985”;
- “internationally renowned”;
- “museum certified”;
- “Armenia’s leading gallery”.

Keep all factual company-history fields editable/configurable.

---

## 13. Private clients

Route: `/{locale}/private-clients`

Sections:
- Private Collectors
- Interior Designers
- Architects
- Hotels & Restaurants
- Developers & Residences

CTA: `Speak with an Art Advisor`

Do not claim services are currently operational unless confirmed. Build the interface/content structure so the owner can enable/disable service blocks.

---

## 14. Art advisory

Support optional service sections:
- Artwork sourcing
- Interior placement
- Private acquisition
- Large-scale sculpture
- Garden & exterior art
- Delivery coordination
- International enquiries

These must be configuration-driven and easy to hide until business confirmation.

---

## 15. “View in an interior”

For paintings, add a polished presentation feature called `View in an Interior`.

V1 does not need AR.

It may display the artwork in example interior compositions, but **never modify the artwork image itself**. If no trustworthy interior composite exists yet, build the UI entry point and use a clearly identified placeholder state rather than fabricating product imagery.

---

## 16. Large sculpture / fountain presentation

Large objects need a different visual rhythm from paintings.

Use large photography and support fields such as:
- dimensions
- indoor/outdoor
- installation notes
- environment
- availability

Editorial phrase direction: `Designed for architectural spaces`.

---

## 17. Enquiry flow

Create an elegant enquiry experience instead of a cart-first flow.

From any artwork:
1. open enquiry form/modal/page;
2. artwork is preselected;
3. fields: name, email, phone/WhatsApp optional, country, message;
4. optional reason: purchase / private viewing / delivery / trade professional;
5. consent checkbox and privacy link;
6. success state.

Do not hardcode a destination email until provided. Implement a safe placeholder/API interface and document the integration point.

Add anti-spam protection architecture (honeypot/rate-limit/captcha-ready) without degrading the design.

---

## 18. Search

Add a refined site search for:
- title
- artist
- category
- object type

Search overlay should feel like a gallery archive, not an e-commerce autocomplete box.

---

## 19. Internationalization quality

All interface strings must come from locale dictionaries. No scattered hardcoded English strings in components.

Translate navigation, buttons, forms, validation, metadata, empty states and legal placeholders across all six languages.

Artwork proper names can preserve their original title, while descriptions and interface surrounding them are localized.

Test long German labels and Cyrillic/Armenian text so layouts do not break.

---

## 20. SEO / social sharing

Implement:
- locale-aware metadata
- Open Graph
- Twitter/X cards
- schema.org structured data where factually safe
- sitemap
- robots
- canonical links
- `hreflang` for six languages

Do not put fabricated prices in Product schema.

---

## 21. Performance

Target excellent Core Web Vitals.

- lazy load below-the-fold imagery;
- pre-load only the true hero asset;
- optimized responsive images;
- no autoplay heavy video background in v1;
- minimize client-side JS;
- avoid layout shift;
- animations should respect `prefers-reduced-motion`.

---

## 22. Accessibility

Luxury is not an excuse for inaccessible UI.

Implement:
- semantic headings
- keyboard navigation
- accessible language selector
- focus states
- correct labels
- adequate contrast
- meaningful alt text based only on known visual information
- reduced-motion support

---

## 23. Responsive behavior

Design desktop, tablet and mobile intentionally.

Mobile is not merely stacked desktop. Preserve premium spacing, image prominence and typography.

Test at minimum:
- 390 px mobile
- 768 px tablet
- 1440 px desktop
- wide desktop

---

## 24. Content/data rules

Never invent factual art-market information.

If unknown, keep `null` and hide the field:
- artist
- year
- material
- origin
- provenance
- authenticity
- certification
- exact price
- availability
- shipping promise

Keep fact data separate from marketing copy.

---

## 25. Required deliverables

Produce:
1. complete source code;
2. responsive working pages;
3. six-language i18n system;
4. premium coat-of-arms/chevron language selector;
5. catalog populated from supplied assets;
6. artwork detail pages;
7. enquiry flow;
8. About / Artists / Private Clients pages;
9. SEO metadata and sitemap;
10. README with local setup and deployment steps;
11. `.env.example` for integrations;
12. a short `CONTENT_TODO.md` listing factual information still needed from the owner;
13. no build errors, TypeScript errors or broken routes.

Before declaring completion, run lint/typecheck/build/tests available in the project and report exact results.

---

## 26. Acceptance criteria

The task is not complete if:
- it looks like a generic store template;
- numerical prices were invented;
- language selector is a native HTML select;
- language selector permanently shows large text labels in the header;
- one or more of the six locales is missing;
- Instagram UI remains in displayed product photography;
- unknown provenance/material/year/authorship was fabricated;
- mobile design feels like an afterthought;
- images are visibly stretched or low-quality;
- build/typecheck fails.

The final impression should be: **private European-style art house, restrained, expensive, editorial, confident and timeless.**
