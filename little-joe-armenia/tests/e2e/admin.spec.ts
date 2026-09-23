import { expect, test } from "./fixtures";

// Admin login requires ADMIN_EMAIL/ADMIN_PASSWORD used by the seed.
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "owner@example.com";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "demo-owner-pass-2026";

test.describe("admin authorization", () => {
  test("unauthenticated admin pages redirect to login", async ({ page }) => {
    for (const path of ["/admin", "/admin/orders", "/admin/settings", "/admin/products"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/admin\/login/);
    }
  });

  test("wrong password is rejected with a generic message", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/пароль/i).fill("definitely-wrong-password");
    await page.getByRole("button", { name: /войти/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.locator("main, body")).toContainText(/неверн/i);
  });

  test("owner signs in and sees dashboard, orders and settings", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/пароль/i).fill(PASSWORD);
    await page.getByRole("button", { name: /войти/i }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
    for (const path of ["/admin/orders", "/admin/products", "/admin/settings", "/admin/translations", "/admin/audit"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page, path).not.toHaveURL(/login|denied/);
    }
  });

  test("admin pages are not indexable", async ({ request }) => {
    const res = await request.get("/admin/login");
    expect(res.headers()["x-robots-tag"]).toContain("noindex");
  });

  test("upload endpoint rejects anonymous requests", async ({ request, baseURL }) => {
    const res = await request.post("/api/admin/upload", { headers: { origin: baseURL! }, multipart: { file: { name: "a.png", mimeType: "image/png", buffer: Buffer.from("x") } } });
    expect(res.status()).toBe(401);
  });
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/пароль/i).fill(PASSWORD);
  await page.getByRole("button", { name: /войти/i }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

test.describe("admin photo manager", () => {
  test("add several photos, make one main, reorder and delete", async ({ page, isMobile }) => {
    // Each project edits its own product: the two projects share one database.
    const product = isMobile ? "Little Cat New Car" : "Little Dog Vanilla";
    const slug = isMobile ? "little-cat-new-car" : "little-dog-vanilla";
    await login(page);
    await page.goto("/admin/photos");
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: product, exact: true }) });
    const status = card.locator("[role=status], [role=alert]");
    const thumbs = card.getByRole("list").getByRole("button");
    const before = Math.max(1, await thumbs.count());

    await card.locator("input[type=file]").setInputFiles(["public/brand/char_dog.webp", "public/brand/char_pup.webp"]);
    await expect(status).toContainText("Добавлено фото: 2");
    await expect(thumbs).toHaveCount(before + 2);
    await expect(card.getByText("★ Главное фото")).toBeVisible();

    await thumbs.nth(1).click();
    await card.getByRole("button", { name: "★ Сделать главным" }).click();
    await expect(status).toContainText("Теперь это главное фото");

    await thumbs.nth(0).click();
    await card.getByRole("button", { name: "Сдвинуть вправо" }).click();
    await expect(status).toContainText("Порядок изменён");

    await thumbs.last().click();
    page.once("dialog", (d) => d.accept());
    await card.getByRole("button", { name: "Удалить" }).click();
    await expect(status).toContainText("Фото удалено");
    await expect(thumbs).toHaveCount(before + 1);

    await page.goto(`/en/p/${slug}`);
    await expect(page.locator("main img").first()).toHaveAttribute("src", /media%2Fblob|\/media\/blob\//);
  });

  test("admin pages fit a phone screen and the menu closes after navigating", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone layout");
    await login(page);
    await page.goto("/admin/products");
    const product = await page.locator('a[href^="/admin/products/c"]').first().getAttribute("href");
    for (const path of ["/admin", "/admin/photos", "/admin/products", product!, "/admin/settings", "/admin/translations", "/admin/orders"]) {
      await page.goto(path);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw, `${path} is wider than the screen`).toBeLessThanOrEqual(cw);
    }
    const menu = page.locator("details", { hasText: "Меню" });
    await menu.locator("summary").click();
    await menu.getByRole("link", { name: "Фото товаров" }).click();
    await expect(page).toHaveURL(/\/admin\/photos/);
    await expect(menu).not.toHaveAttribute("open", "");
  });
});

test.describe("admin prices and launch checklist", () => {
  test("bulk price for a line clears the demo label on the storefront", async ({ page, isMobile }) => {
    // Each project uses its own line: the two projects share one database.
    const line = isMobile ? "Tumble Fresh" : "Little Joe Scented Card";
    const slug = isMobile ? "tumble-fresh-lavender" : "scented-card-lavender";
    const price = isMobile ? "3700" : "1600";
    await login(page);
    await expect(page.getByRole("heading", { name: "Готовность к запуску" })).toBeVisible();
    await page.goto("/admin/prices");
    const card = page.locator("section, div.adm-card").filter({ has: page.getByText(line, { exact: true }) }).last();
    await card.getByLabel("Цена, ֏").fill(price);
    await card.getByLabel("Остаток, шт.").fill("12");
    await card.getByRole("button", { name: "Применить" }).click();
    await expect(card.getByText(/Готово: цена/)).toBeVisible();
    await page.goto(`/en/p/${slug}`);
    await expect(page.getByText("Demo price")).toHaveCount(0);
    await expect(page.locator("main")).toContainText(Number(price).toLocaleString("en-US"));
  });
});
