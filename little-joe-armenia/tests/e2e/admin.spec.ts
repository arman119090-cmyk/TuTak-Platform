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
