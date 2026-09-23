import { describe, expect, it } from "vitest";
import { defaultLocale, isLocale, locales, negotiateLocale } from "@/i18n/config";
import { dictionaries, fmt, getMessages } from "@/i18n/messages";

function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else {
    out[prefix] = obj;
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("negotiateLocale", () => {
  it.each([
    [undefined, "hy"],
    [null, "hy"],
    ["", "hy"],
    ["ru-RU,ru;q=0.9,en;q=0.8", "ru"],
    ["en-US,en;q=0.9", "en"],
    ["it", "it"],
    ["HY-am", "hy"],
    ["de-DE,fr;q=0.9", "hy"],
    ["de;q=1, en;q=0.5, ru;q=0.7", "ru"],
    ["en;q=0, ru;q=0.1", "ru"],
    ["*", "hy"],
  ] as const)("%s → %s", (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it("isLocale/defaultLocale", () => {
    expect(defaultLocale).toBe("hy");
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("message dictionaries (missing translation gate)", () => {
  const en = flatten(dictionaries.en);
  const enKeys = Object.keys(en).sort();

  it("has a dictionary for every locale", () => {
    expect(Object.keys(dictionaries).sort()).toEqual([...locales].sort());
    for (const l of locales) expect(getMessages(l)).toBe(dictionaries[l]);
    expect(enKeys.length).toBeGreaterThan(50);
  });

  describe.each(locales)("%s", (locale) => {
    const dict = flatten(dictionaries[locale]);

    it("has exactly the English key set", () => {
      const keys = Object.keys(dict).sort();
      const missing = enKeys.filter((k) => !(k in dict));
      const extra = keys.filter((k) => !(k in en));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it("has no empty or non-string values", () => {
      const bad = Object.entries(dict).filter(([, v]) => typeof v !== "string" || v.trim() === "");
      expect(bad.map(([k]) => k)).toEqual([]);
    });

    it("uses the same {placeholders} as English for every key", () => {
      const mismatched = enKeys.filter(
        (k) => typeof dict[k] === "string" && JSON.stringify(placeholders(dict[k] as string)) !== JSON.stringify(placeholders(en[k] as string)),
      );
      expect(mismatched).toEqual([]);
    });
  });
});

describe("fmt", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    expect(fmt("{count} items for {name}", { count: 3, name: "Ani" })).toBe("3 items for Ani");
    expect(fmt("Hello {who}", {})).toBe("Hello {who}");
    expect(fmt("no vars")).toBe("no vars");
    expect(fmt("{a}{a}", { a: 0 })).toBe("00");
  });

  it("inserts values as plain text", () => {
    expect(fmt("{x}", { x: "<b>$&</b>" })).toBe("<b>$&</b>");
  });
});
