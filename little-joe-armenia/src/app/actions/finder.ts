"use server";

import { z } from "zod";
import { isLocale, type Locale } from "@/i18n/config";
import { productsByIds, scentProfiles, visibleFamilies, type ProductCardDTO } from "@/lib/catalog";
import { recommend, type Reason } from "@/lib/domain/scent";

const answersSchema = z.object({
  direction: z.enum(["fresh", "sweet", "fruity", "woody", "floral"]),
  strength: z.enum(["subtle", "balanced", "strong"]),
  place: z.enum(["car", "home", "office"]),
  purpose: z.enum(["personal", "gift"]),
});

export type FinderResult = { product: ProductCardDTO; reasons: Reason[] }[];

export async function findScentsAction(locale: string, answers: unknown): Promise<{ results: FinderResult; familyNames: Record<string, string> }> {
  if (!isLocale(locale)) return { results: [], familyNames: {} };
  const a = answersSchema.parse(answers);
  const matches = recommend(await scentProfiles(), a, 3);
  const cards = await productsByIds(matches.map((m) => m.id), locale as Locale);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const families = await visibleFamilies(locale as Locale);
  return {
    results: matches.flatMap((m) => {
      const product = byId.get(m.id);
      return product ? [{ product, reasons: m.reasons }] : [];
    }),
    familyNames: Object.fromEntries(families.map((f) => [f.slug, f.name])),
  };
}
