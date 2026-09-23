import { expect, test } from "./fixtures";

test.describe("locale negotiation: unsupported browser language", () => {
  test.use({ locale: "de-DE" });
  test("root redirects to Armenian by default and html lang is set", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/hy$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "hy-AM");
  });
});

test.describe("locale negotiation: Russian browser", () => {
  test.use({ locale: "ru-RU" });
  test("Accept-Language picks a supported locale", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/ru$/);
  });
});

test.describe("storefront", () => {
  test("locale switching keeps the page and persists the preference", async ({ page, isMobile }) => {
    await page.goto("/en/shop");
    if (isMobile) {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("dialog").getByRole("link", { name: "Русский" }).click();
    } else {
      await page.locator("header summary").click();
      await page.locator("header").getByRole("link", { name: "Русский" }).click();
    }
    await expect(page).toHaveURL(/\/ru\/shop/);
    await expect(page.locator("html")).toHaveAttribute("lang", "ru-AM");
    await page.goto("/");
    await expect(page).toHaveURL(/\/ru$/);
  });

  test("mobile navigation menu opens and navigates", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile only");
    await page.goto("/en");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Scent finder" }).click();
    await expect(page).toHaveURL(/\/en\/scent-finder/);
  });

  test("no horizontal overflow on key pages", async ({ page }) => {
    for (const path of ["/hy", "/hy/shop", "/hy/p/little-joe-cherry", "/hy/scent-finder", "/hy/info/faq"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("search and filters are reflected in the URL and noindexed", async ({ page }) => {
    await page.goto("/en/shop");
    await page.getByRole("searchbox").fill("cherry");
    await page.getByRole("searchbox").press("Enter");
    await expect(page).toHaveURL(/q=cherry/);
    await expect(page.getByTestId("product-card")).toHaveCount(1);
    // Crawlers load the URL fresh: check the server-rendered robots meta.
    const html = await (await page.request.get(page.url())).text();
    expect(html).toMatch(/<meta name="robots" content="noindex/);

    await page.goto("/en/shop?family=fresh");
    const count = await page.getByTestId("product-card").count();
    expect(count).toBeGreaterThan(0);
    await expect(page.getByTestId("result-count")).toContainText(String(count));
    await page.goto("/en/shop?q=zzzznothing");
    await expect(page.getByTestId("empty-results")).toBeVisible();
  });

  test("filter UI toggles a family chip", async ({ page, isMobile }) => {
    await page.goto("/en/shop");
    if (isMobile) await page.getByTestId("open-filters").click();
    const scope = isMobile ? page.getByRole("dialog") : page.locator("aside");
    await scope.getByRole("button", { name: "Sweet" }).click();
    await expect(page).toHaveURL(/family=sweet/);
  });

  test("product page shows facts, SEO metadata and structured data", async ({ page }) => {
    await page.goto("/en/p/little-joe-new-car");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Little Joe New Car");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/p\/little-joe-new-car$/);
    for (const l of ["hy", "ru", "it", "en", "x-default"]) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${l}"]`)).toHaveCount(1);
    }
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const product = ld.map((t) => JSON.parse(t)).flat().find((x) => x["@type"] === "Product");
    expect(product.offers.priceCurrency).toBe("AMD");
    // No reviews exist → no AggregateRating may be emitted.
    expect(product.aggregateRating).toBeUndefined();
    // Demo product → never indexed.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("sold-out product cannot be added", async ({ page }) => {
    await page.goto("/en/p/little-joe-black-velvet");
    await expect(page.getByTestId("stock-status")).toHaveText("Sold out");
    await expect(page.getByTestId("add-to-cart")).toBeDisabled();
  });

  test("wishlist add/remove persists for a guest", async ({ page }) => {
    await page.goto("/en/favorites");
    await expect(page.getByTestId("favorites-empty")).toBeVisible();
    await page.goto("/en/p/little-joe-vanilla");
    const fav = page.locator("main").getByTestId("favorite-button").first();
    await fav.click();
    await expect(fav).toHaveAttribute("aria-pressed", "true");
    await page.waitForLoadState("networkidle");
    await page.goto("/en/favorites");
    await expect(page.getByTestId("product-card")).toHaveCount(1);
  });

  test("scent finder returns explained matches", async ({ page }) => {
    await page.goto("/en/scent-finder");
    for (const answer of ["Fresh & clean", "Subtle", "Car", "For me"]) {
      await page.getByRole("radio", { name: answer }).click();
      await page.getByTestId("finder-next").click();
    }
    await expect(page.getByTestId("finder-result").first()).toBeVisible();
    expect(await page.getByTestId("finder-result").count()).toBeLessThanOrEqual(3);
  });

  test("404 is localised and returns 404", async ({ page }) => {
    const res = await page.goto("/ru/does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("not-found")).toBeVisible();
    const res2 = await page.goto("/en/p/not-a-product");
    expect(res2?.status()).toBe(404);
  });

  test("sitemap and robots", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.ok()).toBeTruthy();
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.ok()).toBeTruthy();
    const xml = await sitemap.text();
    expect(xml).toContain("hreflang");
    // Demo products are never listed.
    expect(xml).not.toContain("/p/little-joe-");
  });

  test("security headers and CSP nonce are present", async ({ request }) => {
    const res = await request.get("/en");
    const h = res.headers();
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("no mixed languages", () => {
  // Each locale shows only its own script (language names in the switcher
  // carry their own lang attribute and are allowed).
  const foreign: Record<string, RegExp> = { hy: /[А-Яа-яЁё]/, ru: /[Ա-ֆ]/, it: /[А-Яа-яЁёԱ-ֆ]/, en: /[А-Яа-яЁёԱ-ֆ]/ };
  for (const locale of Object.keys(foreign)) {
    test(`${locale}: home, shop and product use one language`, async ({ page }) => {
      for (const path of ["", "/shop", "/p/little-joe-new-car", "/info/contact"]) {
        await page.goto(`/${locale}${path}`);
        const hits = await page.evaluate((src) => {
          const r = new RegExp(src);
          const out: string[] = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const t = n.textContent?.trim() ?? "";
            const el = n.parentElement;
            if (t && el && !el.closest("script,style,[lang]:not(html)") && r.test(t)) out.push(t);
          }
          for (const t of document.querySelectorAll("svg text")) if (r.test(t.textContent ?? "")) out.push(t.textContent ?? "");
          return out;
        }, foreign[locale]!.source);
        expect(hits, `${locale}${path}`).toEqual([]);
      }
    });
  }
});
