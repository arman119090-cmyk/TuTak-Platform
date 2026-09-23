import { describe, expect, it, vi } from "vitest";

// catalog.ts creates a Prisma client at import time via @/lib/db; the filter
// helpers are pure, so the client is replaced with a stub.
vi.mock("@/lib/db", () => ({ db: {} }));

const { parseFilters, isFiltered } = await import("@/lib/catalog");

describe("parseFilters", () => {
  it("empty params → defaults, not filtered", () => {
    const f = parseFilters({});
    expect(f).toEqual({
      q: undefined,
      collections: [],
      families: [],
      intensity: [],
      formats: [],
      colors: [],
      minPrice: undefined,
      maxPrice: undefined,
      inStock: false,
      bestseller: false,
      isNew: false,
      gift: false,
      sort: "featured",
    });
    expect(isFiltered(f)).toBe(false);
  });

  it("parses lists (comma or repeated), numbers, flags and sort", () => {
    const f = parseFilters({
      q: "  vanilla  ",
      collection: "classic,deluxe",
      family: ["woody", "fresh"],
      intensity: "1,3,7,x,2.5",
      format: "VENT_CLIP,BOGUS,BOTTLE",
      color: "red",
      min: "1000",
      max: "5000",
      stock: "1",
      bestseller: "1",
      new: "1",
      gift: "1",
      sort: "price-asc",
    });
    expect(f).toEqual({
      q: "vanilla",
      collections: ["classic", "deluxe"],
      families: ["woody", "fresh"],
      intensity: [1, 3],
      formats: ["VENT_CLIP", "BOTTLE"],
      colors: ["red"],
      minPrice: 1000,
      maxPrice: 5000,
      inStock: true,
      bestseller: true,
      isNew: true,
      gift: true,
      sort: "price-asc",
    });
    expect(isFiltered(f)).toBe(true);
  });

  it("drops invalid values", () => {
    const f = parseFilters({ q: "   ", min: "-5", max: "abc", sort: "hack", stock: "true", collection: ",,", color: "x".repeat(61) });
    expect(f.q).toBeUndefined();
    expect(f.minPrice).toBeUndefined();
    expect(f.maxPrice).toBeUndefined();
    expect(f.sort).toBe("featured");
    expect(f.inStock).toBe(false);
    expect(f.collections).toEqual([]);
    expect(f.colors).toEqual([]);
    expect(isFiltered(f)).toBe(false);
  });

  it("caps query length and list size", () => {
    const f = parseFilters({ q: "a".repeat(200), collection: Array.from({ length: 30 }, (_, i) => `c${i}`).join(",") });
    expect(f.q).toHaveLength(80);
    expect(f.collections).toHaveLength(20);
  });

  it.each([
    [{ q: "x" }],
    [{ collection: "a" }],
    [{ family: "a" }],
    [{ intensity: "2" }],
    [{ format: "PAPER" }],
    [{ color: "blue" }],
    [{ min: "0" }],
    [{ max: "100" }],
    [{ stock: "1" }],
    [{ bestseller: "1" }],
    [{ new: "1" }],
    [{ gift: "1" }],
    [{ sort: "name" }],
  ])("any single narrowing param makes it filtered: %o", (sp) => {
    expect(isFiltered(parseFilters(sp))).toBe(true);
  });
});
