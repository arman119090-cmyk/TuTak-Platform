import { expect, type Page } from "@playwright/test";

export async function addFirstProductToCart(page: Page, locale = "en", slug = "little-joe-new-car") {
  await page.goto(`/${locale}/p/${slug}`);
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("cart-line").first()).toBeVisible();
}

export async function fillCheckout(page: Page) {
  await page.getByLabel(/^Name/).fill("Test Buyer");
  await page.getByLabel(/^Phone/).fill("+374 91 234567");
  await page.getByLabel(/^City/).fill("Yerevan");
  await page.getByLabel(/^Street/).fill("Abovyan");
  await page.getByLabel(/^Building/).fill("1");
}
