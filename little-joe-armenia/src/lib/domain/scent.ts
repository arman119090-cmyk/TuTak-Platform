// Scent recommendation engine. Pure functions over structured product
// metadata. A product is only scored on the dimensions that are actually
// filled in — null means "not confirmed" and is never treated as zero.

export type ScentAxis = "sweetness" | "freshness" | "woodiness" | "fruity" | "floral";
export const SCENT_AXES: ScentAxis[] = ["sweetness", "freshness", "woodiness", "fruity", "floral"];

export type ScentProfile = {
  id: string;
  familySlug: string | null;
  intensity: number | null;
  sweetness: number | null;
  freshness: number | null;
  woodiness: number | null;
  fruity: number | null;
  floral: number | null;
  isGift: boolean;
  isBestseller: boolean;
  format: string | null;
  available: boolean;
};

export type FinderAnswers = {
  direction: "fresh" | "sweet" | "fruity" | "woody" | "floral";
  strength: "subtle" | "balanced" | "strong";
  place: "car" | "home" | "office";
  purpose: "personal" | "gift";
};

// Which axis and which family slug each answer points at.
const DIRECTION: Record<FinderAnswers["direction"], { axis: ScentAxis; families: string[] }> = {
  fresh: { axis: "freshness", families: ["fresh", "aquatic", "citrus", "clean"] },
  sweet: { axis: "sweetness", families: ["sweet", "gourmand", "vanilla"] },
  fruity: { axis: "fruity", families: ["fruity"] },
  woody: { axis: "woodiness", families: ["woody", "oriental", "leather"] },
  floral: { axis: "floral", families: ["floral"] },
};

const STRENGTH_TARGET: Record<FinderAnswers["strength"], number> = { subtle: 2, balanced: 3, strong: 4.5 };

export type Reason =
  | { kind: "family"; familySlug: string }
  | { kind: "axis"; axis: ScentAxis }
  | { kind: "intensity"; level: number }
  | { kind: "gift" }
  | { kind: "bestseller" };

export type Match = { id: string; score: number; reasons: Reason[] };

/** True when the product has enough confirmed data to be recommended. */
export function hasProfile(p: ScentProfile): boolean {
  return p.familySlug !== null || SCENT_AXES.some((a) => p[a] !== null);
}

export function scoreProduct(p: ScentProfile, a: FinderAnswers): Match | null {
  if (!p.available || !hasProfile(p)) return null;
  const want = DIRECTION[a.direction];
  const reasons: Reason[] = [];
  let score = 0;

  if (p.familySlug && want.families.includes(p.familySlug)) {
    score += 40;
    reasons.push({ kind: "family", familySlug: p.familySlug });
  }
  const axisValue = p[want.axis];
  if (axisValue !== null) {
    score += axisValue * 8; // up to 40
    if (axisValue >= 3) reasons.push({ kind: "axis", axis: want.axis });
  }
  if (p.intensity !== null) {
    const distance = Math.abs(p.intensity - STRENGTH_TARGET[a.strength]);
    score += Math.max(0, 15 - distance * 6);
    if (distance <= 1) reasons.push({ kind: "intensity", level: p.intensity });
  }
  // Very strong scents are a poor fit for small shared spaces.
  if (a.place === "office" && p.intensity !== null && p.intensity >= 5) score -= 10;
  if (a.purpose === "gift" && p.isGift) {
    score += 8;
    reasons.push({ kind: "gift" });
  }
  if (p.isBestseller) {
    score += 3;
    reasons.push({ kind: "bestseller" });
  }
  if (reasons.length === 0 || score <= 0) return null;
  return { id: p.id, score, reasons };
}

export function recommend(products: ScentProfile[], answers: FinderAnswers, limit = 3): Match[] {
  return products
    .map((p) => scoreProduct(p, answers))
    .filter((m): m is Match => m !== null)
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
    .slice(0, limit);
}

/**
 * Similarity between two products over the dimensions both have confirmed.
 * Returns null when there is no shared data (so nothing is fabricated).
 */
export function similarity(a: ScentProfile, b: ScentProfile): number | null {
  let shared = 0;
  let distance = 0;
  for (const axis of SCENT_AXES) {
    const x = a[axis];
    const y = b[axis];
    if (x !== null && y !== null) {
      shared++;
      distance += (x - y) ** 2;
    }
  }
  const sameFamily = a.familySlug !== null && a.familySlug === b.familySlug;
  if (shared === 0 && !sameFamily) return null;
  const axisScore = shared > 0 ? 1 - Math.sqrt(distance / shared) / 5 : 0;
  return axisScore + (sameFamily ? 0.5 : 0);
}
