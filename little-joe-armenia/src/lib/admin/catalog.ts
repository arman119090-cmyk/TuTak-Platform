import { LOCALES, LOCALE_LABEL, type AdminLocale } from "@/lib/admin/format";

// Pure rules shared by product pages and product actions.

type T = { locale: string; name: string | null } & Record<string, unknown>;

export type Completeness = "ok" | "partial" | "missing";

/** Name present = usable; name + descriptions + SEO = complete. */
export function translationState(rows: T[], locale: AdminLocale, fields: string[]): Completeness {
  const row = rows.find((r) => r.locale === locale);
  if (!row || !row.name || !String(row.name).trim()) return "missing";
  const empty = fields.some((f) => {
    const v = row[f];
    return v === null || v === undefined || String(v).trim() === "";
  });
  return empty ? "partial" : "ok";
}

export const PRODUCT_TEXT_FIELDS = ["scentDescriptor", "profileDescription", "seoTitle", "seoDescription"];

/**
 * Why a product cannot be published (status ACTIVE). Empty = publishable.
 * Requirements: a name in all four locales and at least one active variant
 * with a price.
 */
export function publishBlockers(p: {
  translations: { locale: string; name: string }[];
  variants: { isActive: boolean; priceAmd: number | null }[];
}): string[] {
  const out: string[] = [];
  const missing = LOCALES.filter((l) => !p.translations.find((t) => t.locale === l && t.name.trim()));
  if (missing.length) out.push(`Нет названия на языках: ${missing.map((l) => LOCALE_LABEL[l]).join(", ")}`);
  if (!p.variants.some((v) => v.isActive && v.priceAmd !== null && v.priceAmd > 0)) {
    out.push("Нет ни одного активного варианта с ценой");
  }
  return out;
}
