import "server-only";
import type { DeliveryMethod } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";

/** Active delivery methods serving `region` (all active when region is null). */
export async function deliveryOptions(region: string | null): Promise<DeliveryMethod[]> {
  const all = await db.deliveryMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  if (!region) return all;
  return all.filter((m) => m.regions.length === 0 || m.regions.includes(region));
}

export function deliveryName(m: Pick<DeliveryMethod, "nameHy" | "nameRu" | "nameIt" | "nameEn">, locale: Locale): string {
  return { hy: m.nameHy, ru: m.nameRu, it: m.nameIt, en: m.nameEn }[locale];
}

export function deliveryEta(m: Pick<DeliveryMethod, "etaHy" | "etaRu" | "etaIt" | "etaEn">, locale: Locale): string | null {
  return { hy: m.etaHy, ru: m.etaRu, it: m.etaIt, en: m.etaEn }[locale];
}

/** Lowest free-delivery threshold among active methods, for the cart hint. */
export async function freeDeliveryThreshold(): Promise<number | null> {
  const m = await db.deliveryMethod.findFirst({
    where: { isActive: true, freeFromAmd: { not: null } },
    orderBy: { freeFromAmd: "asc" },
    select: { freeFromAmd: true },
  });
  return m?.freeFromAmd ?? null;
}
