import { describe, expect, it } from "vitest";
import { formatAmd } from "@/lib/money";
import { isRegionCode, normalizeArmenianPhone, REGION_CODES } from "@/lib/armenia";

const NBSP = " ";

describe("formatAmd", () => {
  it.each([
    ["hy", 0, `0${NBSP}֏`],
    ["hy", 12500, `12${NBSP}500${NBSP}֏`],
    ["hy", 1_000_000, `1${NBSP}000${NBSP}000${NBSP}֏`],
    ["hy", -2500, `−2${NBSP}500${NBSP}֏`],
    ["ru", 0, `0${NBSP}֏`],
    ["ru", 1_000_000, `1${NBSP}000${NBSP}000${NBSP}֏`],
    ["ru", -1_000_000, `−1${NBSP}000${NBSP}000${NBSP}֏`],
    ["it", 0, `0${NBSP}֏`],
    ["it", 1_000_000, `1.000.000${NBSP}֏`],
    ["it", -12500, `−12.500${NBSP}֏`],
    ["en", 0, "֏0"],
    ["en", 1_000_000, "֏1,000,000"],
    ["en", -12500, "−֏12,500"],
    ["en", 999, "֏999"],
    ["en", 1000, "֏1,000"],
  ] as const)("%s %d → %s", (locale, amount, expected) => {
    expect(formatAmd(amount, locale)).toBe(expected);
  });
});

describe("normalizeArmenianPhone", () => {
  it.each([
    "+374 91 234567",
    "+37491234567",
    "091234567",
    "091 23 45 67",
    "(091) 23-45-67",
    "0037491234567",
    "37491234567",
    "91234567",
  ])("accepts %s", (input) => {
    expect(normalizeArmenianPhone(input)).toBe("+37491234567");
  });

  it.each([
    "",
    "12345",
    "+374 91 23456", // 7 digits
    "+374 91 2345678", // 9 digits
    "+7 912 345 67 89",
    "+374 01 234567", // subscriber number starting with 0
    "0012345678",
    "abcdefgh",
    "374912345678", // 374 + 9 digits
  ])("rejects %s", (input) => {
    expect(normalizeArmenianPhone(input)).toBeNull();
  });

  it("region codes are the 11 ISO 3166-2:AM codes", () => {
    expect(REGION_CODES).toHaveLength(11);
    expect(isRegionCode("ER")).toBe(true);
    expect(isRegionCode("XX")).toBe(false);
    expect(isRegionCode(1)).toBe(false);
  });
});
