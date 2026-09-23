import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// env() is read lazily by the modules below; give it a minimal valid config.
beforeAll(() => {
  process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
  process.env.SESSION_SECRET ??= "unit-test-secret-0123456789abcdef0123456789";
  process.env.APP_URL = "https://shop.example.am";
});

const { hashPassword, verifyPassword } = await import("@/lib/security/password");
const { idramChecksum } = await import("@/lib/payments/adapters/idram");
const { productLd } = await import("@/lib/seo/jsonld");

describe("password hashing", () => {
  it("round-trips and rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash and rejects malformed stored values", async () => {
    const a = await hashPassword("pw");
    const b = await hashPassword("pw");
    expect(a).not.toBe(b);
    expect(await verifyPassword("pw", "plain-text")).toBe(false);
    expect(await verifyPassword("pw", "bcrypt$1$2$3$4$5")).toBe(false);
  });
});

describe("idramChecksum", () => {
  const fields = {
    EDP_REC_ACCOUNT: "110000601",
    EDP_AMOUNT: "12500.00",
    EDP_BILL_NO: "cmbill123",
    EDP_PAYER_ACCOUNT: "100012345",
    EDP_TRANS_ID: "0123456789",
    EDP_TRANS_DATE: "23/09/2026",
  };

  it("is uppercase MD5 of the documented field order", () => {
    const raw = ["110000601", "12500.00", "s3cret", "cmbill123", "100012345", "0123456789", "23/09/2026"].join(":");
    const expected = createHash("md5").update(raw).digest("hex").toUpperCase();
    expect(idramChecksum(fields, "s3cret")).toBe(expected);
    expect(expected).toMatch(/^[0-9A-F]{32}$/);
  });

  it("is deterministic and depends on secret and every field", () => {
    expect(idramChecksum(fields, "s3cret")).toBe(idramChecksum({ ...fields }, "s3cret"));
    expect(idramChecksum(fields, "other")).not.toBe(idramChecksum(fields, "s3cret"));
    for (const k of Object.keys(fields) as (keyof typeof fields)[]) {
      expect(idramChecksum({ ...fields, [k]: fields[k] + "1" }, "s3cret")).not.toBe(idramChecksum(fields, "s3cret"));
    }
  });
});

describe("productLd", () => {
  const base = {
    name: "Little Joe Vanilla",
    path: "/hy/p/vanilla",
    description: "Sweet vanilla",
    images: ["/media/vanilla.jpg"],
    sku: "LJ-VAN",
    gtin13: null,
    mpn: null,
    brand: "Little Joe",
    collection: "Classic",
    priceAmd: 2500,
    available: true,
    rating: null,
    reviews: [],
  };

  it("has no aggregateRating/review when rating is null or count is 0", () => {
    const a = productLd(base);
    expect(a).not.toHaveProperty("aggregateRating");
    expect(a).not.toHaveProperty("review");
    const b = productLd({ ...base, rating: { average: 0, count: 0 } });
    expect(b).not.toHaveProperty("aggregateRating");
    expect(b).not.toHaveProperty("review");
  });

  it("includes aggregateRating and reviews from real reviews", () => {
    const ld = productLd({
      ...base,
      rating: { average: 4.66, count: 2 },
      reviews: [
        { authorName: "Ani", rating: 5, body: "Great", createdAt: new Date("2026-09-01T10:00:00Z") },
        { authorName: "Aram", rating: 4, body: "Good", createdAt: new Date("2026-09-02T10:00:00Z") },
      ],
    });
    expect(ld.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.7,
      reviewCount: 2,
      bestRating: 5,
      worstRating: 1,
    });
    expect(ld.review).toHaveLength(2);
    expect((ld.review as { datePublished: string }[])[0]!.datePublished).toBe("2026-09-01");
  });

  it("includes gtin13 only when passed", () => {
    expect(productLd(base)).not.toHaveProperty("gtin13");
    expect(productLd({ ...base, gtin13: "4820000000000" }).gtin13).toBe("4820000000000");
  });

  it("offers only with a price; absolute URLs; availability", () => {
    const ld = productLd(base);
    expect(ld.url).toBe("https://shop.example.am/hy/p/vanilla");
    expect(ld.image).toEqual(["https://shop.example.am/media/vanilla.jpg"]);
    expect(ld.offers).toMatchObject({ priceCurrency: "AMD", price: 2500, availability: "https://schema.org/InStock" });
    expect(productLd({ ...base, available: false }).offers).toMatchObject({ availability: "https://schema.org/OutOfStock" });
    expect(productLd({ ...base, priceAmd: null })).not.toHaveProperty("offers");
  });
});
