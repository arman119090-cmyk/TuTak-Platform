import { describe, expect, it } from "vitest";
import { hasProfile, recommend, scoreProduct, similarity, type FinderAnswers, type ScentProfile } from "@/lib/domain/scent";

function p(id: string, over: Partial<ScentProfile> = {}): ScentProfile {
  return {
    id,
    familySlug: null,
    intensity: null,
    sweetness: null,
    freshness: null,
    woodiness: null,
    fruity: null,
    floral: null,
    isGift: false,
    isBestseller: false,
    format: null,
    available: true,
    ...over,
  };
}

const fresh: FinderAnswers = { direction: "fresh", strength: "balanced", place: "car", purpose: "personal" };

describe("hasProfile", () => {
  it("is false only when family and every axis are null", () => {
    expect(hasProfile(p("x"))).toBe(false);
    expect(hasProfile(p("x", { intensity: 3 }))).toBe(false); // intensity is not a scent axis
    expect(hasProfile(p("x", { familySlug: "woody" }))).toBe(true);
    expect(hasProfile(p("x", { floral: 0 }))).toBe(true);
  });
});

describe("recommend", () => {
  const catalog = [
    p("a", { familySlug: "fresh", freshness: 5, intensity: 3 }), // 40 + 40 + 15 = 95
    p("b", { freshness: 4 }), // 32
    p("c", { familySlug: "citrus" }), // 40
    p("d", { freshness: 1 }), // 8 but no reason → excluded
    p("e", { familySlug: "fresh", freshness: 5, intensity: 3, available: false }),
    p("f", { isBestseller: true, isGift: true }), // no profile
    p("g", { familySlug: "woody", woodiness: 5, intensity: 3 }), // 15 (intensity only)
  ];

  it("returns at most 3, best first, with reasons", () => {
    const res = recommend(catalog, fresh);
    expect(res.length).toBeLessThanOrEqual(3);
    expect(res.map((m) => m.id)).toEqual(["a", "c", "b"]);
    expect(res[0]).toEqual({
      id: "a",
      score: 95,
      reasons: [
        { kind: "family", familySlug: "fresh" },
        { kind: "axis", axis: "freshness" },
        { kind: "intensity", level: 3 },
      ],
    });
    expect(res[1]!.reasons).toEqual([{ kind: "family", familySlug: "citrus" }]);
    expect(res[2]!.reasons).toEqual([{ kind: "axis", axis: "freshness" }]);
  });

  it("respects a custom limit and a large catalog never yields more than 3 by default", () => {
    const many = Array.from({ length: 20 }, (_, i) => p(`m${String(i).padStart(2, "0")}`, { familySlug: "fresh" }));
    expect(recommend(many, fresh)).toHaveLength(3);
    // equal scores → stable order by id
    expect(recommend(many, fresh).map((m) => m.id)).toEqual(["m00", "m01", "m02"]);
    expect(recommend(catalog, fresh, 1).map((m) => m.id)).toEqual(["a"]);
  });

  it("ignores unavailable products and products without a profile", () => {
    const ids = recommend(catalog, fresh, 10).map((m) => m.id);
    expect(ids).not.toContain("e");
    expect(ids).not.toContain("f");
    expect(scoreProduct(catalog[4]!, fresh)).toBeNull();
    expect(scoreProduct(catalog[5]!, { ...fresh, purpose: "gift" })).toBeNull();
  });

  it("drops matches with no reason", () => {
    expect(scoreProduct(p("d", { freshness: 1 }), fresh)).toBeNull();
  });

  it("returns an empty list when nothing matches", () => {
    expect(recommend([], fresh)).toEqual([]);
    expect(recommend([p("x"), p("y", { available: false, familySlug: "fresh" })], fresh)).toEqual([]);
  });

  it("never treats a null axis or intensity as 0", () => {
    // If intensity null were 0, subtle (target 2) would add 15 - 2*6 = 3 points.
    const subtle: FinderAnswers = { ...fresh, strength: "subtle" };
    expect(scoreProduct(p("n", { familySlug: "fresh" }), subtle)!.score).toBe(40);
    // An explicit 0 on the wanted axis contributes 0 points and no reason; null the same, but
    // a product whose ONLY data is a null axis is not scored at all.
    expect(scoreProduct(p("z", { familySlug: "fresh", freshness: 0 }), fresh)!.score).toBe(40);
    expect(scoreProduct(p("z", { familySlug: "fresh", freshness: null }), fresh)!.score).toBe(40);
  });

  it("adds gift and bestseller reasons; penalises very strong scents in the office", () => {
    const gift = scoreProduct(p("g", { familySlug: "fresh", isGift: true, isBestseller: true }), { ...fresh, purpose: "gift" })!;
    expect(gift.score).toBe(40 + 8 + 3);
    expect(gift.reasons).toContainEqual({ kind: "gift" });
    expect(gift.reasons).toContainEqual({ kind: "bestseller" });

    const strong = p("s", { familySlug: "fresh", intensity: 5 });
    const car = scoreProduct(strong, { ...fresh, strength: "strong" })!.score;
    const office = scoreProduct(strong, { ...fresh, strength: "strong", place: "office" })!.score;
    expect(car - office).toBe(10);
  });
});

describe("similarity", () => {
  it("is null without shared confirmed data", () => {
    expect(similarity(p("a"), p("b"))).toBeNull();
    expect(similarity(p("a", { freshness: 3 }), p("b", { sweetness: 3 }))).toBeNull();
    expect(similarity(p("a", { familySlug: "fresh" }), p("b", { familySlug: "woody" }))).toBeNull();
  });

  it("compares only axes both have (null is not 0)", () => {
    expect(similarity(p("a", { freshness: 5, sweetness: null }), p("b", { freshness: 5, sweetness: 5 }))).toBe(1);
    expect(similarity(p("a", { freshness: 0 }), p("b", { freshness: 5 }))).toBe(0);
  });

  it("same family adds 0.5, also without shared axes", () => {
    expect(similarity(p("a", { familySlug: "fresh" }), p("b", { familySlug: "fresh" }))).toBe(0.5);
    expect(similarity(p("a", { familySlug: "fresh", floral: 2 }), p("b", { familySlug: "fresh", floral: 2 }))).toBe(1.5);
  });
});
