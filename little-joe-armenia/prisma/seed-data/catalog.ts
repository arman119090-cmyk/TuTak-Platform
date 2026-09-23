// Catalog seed data.
//
// READ THIS BEFORE EDITING — see docs/PRODUCT_DATA_SOURCES.md.
//
// The official manufacturer site (little-joe.com, Drive Int. AG) could not
// be reached from the build environment, and no approved Armenia assortment
// matrix was supplied. Therefore:
//
// * `families` (fragrance families) is the SHOP'S OWN taxonomy — not a
//   manufacturer claim.
// * `demoProducts` are DEMO ONLY (Product.isDemo = true, hidden unless
//   DEMO_MODE=true). Every product fact is UNVERIFIED and carries the source
//   it came from (task brief or a third-party retailer listing). Prices are
//   placeholders (priceIsDemo). Stock numbers are arbitrary demo values.
// * No EAN, article number, duration, dimensions or scent notes are seeded.
//   Retailer claims about duration etc. go to the import-review queue only.
// * Scent family assignments in the demo are derived from the scent NAME
//   (e.g. "Fresh Mint" → fresh). They are placeholders to exercise the scent
//   finder and must be replaced with manufacturer data.

import type { Locale } from "../../src/generated/prisma/enums";

type L<T = string> = Record<Locale, T>;

export const families: { slug: string; sortOrder: number; accentColor: string; name: L; description: L }[] = [
  {
    slug: "fresh",
    sortOrder: 1,
    accentColor: "#7FD4B0",
    name: { hy: "Թարմ", ru: "Свежие", it: "Freschi", en: "Fresh" },
    description: {
      hy: "Մաքուր, թեթև և զով բույրեր։",
      ru: "Чистые, лёгкие и прохладные ароматы.",
      it: "Profumi puliti, leggeri e freschi.",
      en: "Clean, light and cool fragrances.",
    },
  },
  {
    slug: "sweet",
    sortOrder: 2,
    accentColor: "#F3E3B5",
    name: { hy: "Քաղցր", ru: "Сладкие", it: "Dolci", en: "Sweet" },
    description: {
      hy: "Տաք, փափուկ և քաղցր բույրեր։",
      ru: "Тёплые, мягкие и сладкие ароматы.",
      it: "Profumi caldi, morbidi e dolci.",
      en: "Warm, soft and sweet fragrances.",
    },
  },
  {
    slug: "fruity",
    sortOrder: 3,
    accentColor: "#F08A8A",
    name: { hy: "Մրգային", ru: "Фруктовые", it: "Fruttati", en: "Fruity" },
    description: {
      hy: "Հյութալի և վառ մրգային բույրեր։",
      ru: "Сочные и яркие фруктовые ароматы.",
      it: "Profumi fruttati, succosi e vivaci.",
      en: "Juicy, bright fruit fragrances.",
    },
  },
  {
    slug: "woody",
    sortOrder: 4,
    accentColor: "#8B6B4A",
    name: { hy: "Փայտային", ru: "Древесные", it: "Legnosi", en: "Woody" },
    description: {
      hy: "Խորը, տաք և զուսպ բույրեր։",
      ru: "Глубокие, тёплые и сдержанные ароматы.",
      it: "Profumi profondi, caldi e sobri.",
      en: "Deep, warm and understated fragrances.",
    },
  },
  {
    slug: "floral",
    sortOrder: 5,
    accentColor: "#E7A6C8",
    name: { hy: "Ծաղկային", ru: "Цветочные", it: "Floreali", en: "Floral" },
    description: {
      hy: "Նուրբ ծաղկային բույրեր։",
      ru: "Нежные цветочные ароматы.",
      it: "Delicati profumi floreali.",
      en: "Delicate floral fragrances.",
    },
  },
];

const RETAILER_STONER = "https://stonercarcare.com/collections/little-joe";
const RETAILER_POPSHELF_NEWCAR = "https://www.popshelf.com/p/little-joe-car-air-freshener-new-car-scent";
const RETAILER_WALMART_OCEAN = "https://www.walmart.com/ip/892299258";

export type SourceType = "TASK_BRIEF" | "RETAILER_LISTING" | "INTERNAL";

export const collections: {
  slug: string;
  sortOrder: number;
  accentColor: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  name: L;
}[] = [
  {
    slug: "little-joe",
    sortOrder: 1,
    accentColor: "#2F6FDE",
    sourceType: "RETAILER_LISTING",
    sourceUrl: RETAILER_STONER,
    name: { hy: "Little Joe", ru: "Little Joe", it: "Little Joe", en: "Little Joe" },
  },
  // The collections below are named in the task brief and in retailer
  // listings. No product is assigned to them, so the storefront hides them
  // ("do not hard-code unsupported collections").
  {
    slug: "little-joya",
    sortOrder: 2,
    accentColor: "#E7A6C8",
    sourceType: "RETAILER_LISTING",
    sourceUrl: RETAILER_STONER,
    name: { hy: "Little Joya", ru: "Little Joya", it: "Little Joya", en: "Little Joya" },
  },
  {
    slug: "little-pup",
    sortOrder: 3,
    accentColor: "#C9A27A",
    sourceType: "RETAILER_LISTING",
    sourceUrl: RETAILER_STONER,
    name: { hy: "Little Pup", ru: "Little Pup", it: "Little Pup", en: "Little Pup" },
  },
  {
    slug: "little-cat",
    sortOrder: 4,
    accentColor: "#E9E4DC",
    sourceType: "INTERNAL",
    sourceUrl: null,
    name: { hy: "Little Cat", ru: "Little Cat", it: "Little Cat", en: "Little Cat" },
  },
  {
    slug: "little-dog",
    sortOrder: 5,
    accentColor: "#7FCBF0",
    sourceType: "INTERNAL",
    sourceUrl: null,
    name: { hy: "Little Dog", ru: "Little Dog", it: "Little Dog", en: "Little Dog" },
  },
  {
    slug: "little-duck",
    sortOrder: 4,
    accentColor: "#F2C94C",
    sourceType: "RETAILER_LISTING",
    sourceUrl: RETAILER_STONER,
    name: { hy: "Little Duck", ru: "Little Duck", it: "Little Duck", en: "Little Duck" },
  },
];

export type DemoProduct = {
  slug: string;
  /** Collection slug (default little-joe). */
  collection?: string;
  /** Full product name; default "Little Joe <scentName>". */
  displayName?: string;
  scentName: string;
  nameSource: { type: SourceType; url: string | null };
  // UI accent chosen for the demo (brief gives blue/cream/red/graphite/green
  // for five scents; the rest are internal design choices).
  accent: string;
  ink: string;
  accentSource: "TASK_BRIEF" | "INTERNAL";
  // DEMO placeholder derived from the scent name. null = unknown.
  family: string | null;
  demoPriceAmd: number;
  demoStock: number;
  flags: { bestseller?: boolean; isNew?: boolean; gift?: boolean; featured?: boolean };
};

export const demoProducts: DemoProduct[] = [
  { slug: "little-joe-new-car", scentName: "New Car", nameSource: { type: "RETAILER_LISTING", url: RETAILER_POPSHELF_NEWCAR }, accent: "#2F6FDE", ink: "#FFFFFF", accentSource: "TASK_BRIEF", family: "fresh", demoPriceAmd: 2900, demoStock: 40, flags: { bestseller: true, featured: true } },
  { slug: "little-joe-vanilla", scentName: "Vanilla", nameSource: { type: "TASK_BRIEF", url: null }, accent: "#F3E3B5", ink: "#3A2E12", accentSource: "TASK_BRIEF", family: "sweet", demoPriceAmd: 2900, demoStock: 25, flags: { bestseller: true, gift: true, featured: true } },
  { slug: "little-joe-cherry", scentName: "Cherry", nameSource: { type: "TASK_BRIEF", url: null }, accent: "#C8202F", ink: "#FFFFFF", accentSource: "TASK_BRIEF", family: "fruity", demoPriceAmd: 2900, demoStock: 2, flags: { featured: true } },
  { slug: "little-joe-black-velvet", scentName: "Black Velvet", nameSource: { type: "TASK_BRIEF", url: null }, accent: "#2B2B2E", ink: "#FFFFFF", accentSource: "TASK_BRIEF", family: null, demoPriceAmd: 3200, demoStock: 0, flags: { gift: true, featured: true } },
  { slug: "little-joe-fresh-mint", scentName: "Fresh Mint", nameSource: { type: "TASK_BRIEF", url: null }, accent: "#6FCFA6", ink: "#0E3325", accentSource: "TASK_BRIEF", family: "fresh", demoPriceAmd: 2900, demoStock: 18, flags: { isNew: true, featured: true } },
  { slug: "little-joe-ocean-splash", scentName: "Ocean Splash", nameSource: { type: "RETAILER_LISTING", url: RETAILER_WALMART_OCEAN }, accent: "#3BB3D6", ink: "#062B36", accentSource: "INTERNAL", family: "fresh", demoPriceAmd: 2500, demoStock: 30, flags: { bestseller: true } },
  { slug: "little-joe-blue-raspberry", scentName: "Blue Raspberry", nameSource: { type: "RETAILER_LISTING", url: RETAILER_STONER }, accent: "#3F5BD9", ink: "#FFFFFF", accentSource: "INTERNAL", family: "fruity", demoPriceAmd: 2500, demoStock: 12, flags: { isNew: true } },
  { slug: "little-joe-orange-creamsicle", scentName: "Orange Creamsicle", nameSource: { type: "RETAILER_LISTING", url: RETAILER_STONER }, accent: "#F7A35C", ink: "#3A1D05", accentSource: "INTERNAL", family: "sweet", demoPriceAmd: 2500, demoStock: 9, flags: { gift: true } },
  { slug: "little-joe-green-apple", scentName: "Green Apple", nameSource: { type: "RETAILER_LISTING", url: RETAILER_STONER }, accent: "#8CC63F", ink: "#1B2B06", accentSource: "INTERNAL", family: "fruity", demoPriceAmd: 2500, demoStock: 22, flags: {} },
  // Other characters of the family, from photos the store owner supplied on
  // 2026-09-23. Scent names are unknown, so the product is named after the
  // character only; family stays null (not guessed).
  { slug: "little-joya", collection: "little-joya", displayName: "Little Joya", scentName: "Little Joya", nameSource: { type: "INTERNAL", url: null }, accent: "#B79BE3", ink: "#2C1D4A", accentSource: "INTERNAL", family: null, demoPriceAmd: 2900, demoStock: 14, flags: { isNew: true, featured: true, gift: true } },
  { slug: "little-pup", collection: "little-pup", displayName: "Little Pup", scentName: "Little Pup", nameSource: { type: "INTERNAL", url: null }, accent: "#3F68CF", ink: "#FFFFFF", accentSource: "INTERNAL", family: null, demoPriceAmd: 2900, demoStock: 11, flags: { isNew: true, featured: true } },
  { slug: "little-cat", collection: "little-cat", displayName: "Little Cat", scentName: "Little Cat", nameSource: { type: "INTERNAL", url: null }, accent: "#E9E4DC", ink: "#2B2723", accentSource: "INTERNAL", family: null, demoPriceAmd: 2900, demoStock: 9, flags: { isNew: true, gift: true } },
  { slug: "little-dog", collection: "little-dog", displayName: "Little Dog", scentName: "Little Dog", nameSource: { type: "INTERNAL", url: null }, accent: "#7FCBF0", ink: "#0B2F42", accentSource: "INTERNAL", family: null, demoPriceAmd: 2900, demoStock: 16, flags: { isNew: true, featured: true } },
];

/**
 * Product images (public/brand). Little Joe colours are cut from the
 * owner's design mockup and recoloured per scent; the other characters are
 * cut from the owner's photos. Rights: supplied by the store owner — kept
 * UNCONFIRMED until usage rights are documented (docs/ASSETS.md).
 */
export const productImages: Record<string, { file: string; width: number; height: number }> = {
  "little-joe-new-car": { file: "joe_new-car.webp", width: 626, height: 759 },
  "little-joe-vanilla": { file: "joe_vanilla.webp", width: 626, height: 759 },
  "little-joe-cherry": { file: "joe_cherry.webp", width: 626, height: 759 },
  "little-joe-black-velvet": { file: "joe_black-velvet.webp", width: 626, height: 759 },
  "little-joe-fresh-mint": { file: "joe_fresh-mint.webp", width: 626, height: 759 },
  "little-joe-ocean-splash": { file: "joe_ocean-splash.webp", width: 626, height: 759 },
  "little-joe-blue-raspberry": { file: "joe_blue-raspberry.webp", width: 626, height: 759 },
  "little-joe-orange-creamsicle": { file: "joe_orange-creamsicle.webp", width: 626, height: 759 },
  "little-joe-green-apple": { file: "joe_green-apple.webp", width: 626, height: 759 },
  "little-joya": { file: "char_joya.webp", width: 612, height: 727 },
  "little-pup": { file: "char_pup.webp", width: 557, height: 800 },
  "little-cat": { file: "char_cat.webp", width: 571, height: 800 },
  "little-dog": { file: "char_dog.webp", width: 726, height: 706 },
};

/** Claims seen on third-party pages. Stored UNVERIFIED; never rendered until verified in admin. */
export const brandClaims = [
  {
    key: "made-in-italy",
    sourceUrl: RETAILER_STONER,
    title: { hy: "Արտադրված է Իտալիայում", ru: "Сделано в Италии", it: "Prodotto in Italia", en: "Made in Italy" },
  },
  {
    key: "swiss-company",
    sourceUrl: RETAILER_STONER,
    title: {
      hy: "Drive Int. AG, Շվեյցարիա",
      ru: "Drive Int. AG, Швейцария",
      it: "Drive Int. AG, Svizzera",
      en: "Drive Int. AG, Switzerland",
    },
  },
  {
    key: "70-countries",
    sourceUrl: RETAILER_STONER,
    title: {
      hy: "Վաճառվում է ավելի քան 70 երկրում",
      ru: "Продаётся более чем в 70 странах",
      it: "Venduto in oltre 70 paesi",
      en: "Sold in more than 70 countries",
    },
  },
];

/** Retailer claims routed to the import-review queue instead of product fields. */
export const importReviewItems = [
  {
    entity: "Product",
    entityKey: "*",
    field: "durationDays",
    proposed: "45",
    sourceUrl: RETAILER_STONER,
    reason: "Retailer page claims 'up to 45 days'. Not from manufacturer; duration must be confirmed per product.",
  },
  {
    entity: "Product",
    entityKey: "little-joe-ocean-splash",
    field: "articleNumber",
    proposed: "96403",
    sourceUrl: RETAILER_WALMART_OCEAN,
    reason: "Number appears in a Walmart listing title; unclear whether it is the manufacturer article number.",
  },
  {
    entity: "Collection",
    entityKey: "*",
    field: "assortment",
    proposed: null,
    sourceUrl: null,
    reason: "Approved Armenia assortment matrix not supplied. All demo products are placeholders.",
  },
];
