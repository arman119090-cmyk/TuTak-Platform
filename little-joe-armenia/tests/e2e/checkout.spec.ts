import { expect, test } from "@playwright/test";
import { addFirstProductToCart, fillCheckout } from "./helpers";

test.describe("cart and checkout", () => {
  test("cart: quantity, save for later, remove, empty state", async ({ page }) => {
    await addFirstProductToCart(page);
    await page.goto("/en/cart");
    await page.getByRole("button", { name: "Increase quantity" }).first().click();
    await expect(page.getByTestId("cart-line").locator("output")).toHaveText("2");
    await page.getByRole("button", { name: "Save for later" }).click();
    await expect(page.getByText("Saved for later")).toBeVisible();
    await page.getByRole("button", { name: "Move to cart" }).click();
    await page.getByTestId("cart-line").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Your cart is empty.")).toBeVisible();
  });

  test("promo code: invalid and valid", async ({ page }) => {
    await addFirstProductToCart(page);
    await page.goto("/en/cart");
    await page.getByLabel("Promo code").fill("NOPE");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("This code doesn't exist.")).toBeVisible();
    // WELCOME10 needs 5 000 AMD: 2 units of 2 900.
    await page.getByRole("button", { name: "Increase quantity" }).first().click();
    await expect(page.getByTestId("cart-line").locator("output")).toHaveText("2");
    await page.getByLabel("Promo code").fill("welcome10");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("promo-applied")).toBeVisible();
    await expect(page.getByTestId("cart-total")).toHaveText("֏5,220");
  });

  test("guest checkout with cash on delivery", async ({ page }) => {
    await addFirstProductToCart(page);
    await page.goto("/en/checkout");
    await fillCheckout(page);
    await page.getByTestId("pay-CASH_ON_DELIVERY").check();
    await page.getByTestId("place-order").click();
    await expect(page).toHaveURL(/\/en\/order\/LJ-/);
    await expect(page.getByTestId("order-status")).toHaveText("Received");
    // The order link carries a token; without it the order is not visible.
    const url = new URL(page.url());
    await page.goto(url.pathname);
    await expect(page.getByText("Order not found.")).toBeVisible();
  });

  test("checkout validation shows localised errors", async ({ page }) => {
    await addFirstProductToCart(page, "ru");
    await page.goto("/ru/checkout");
    await page.getByLabel(/^Телефон/).fill("123");
    await page.getByTestId("place-order").click();
    await expect(page.getByText("Введите корректный армянский номер")).toBeVisible();
  });

  test("mock online payment: success marks the order paid only via callback", async ({ page }) => {
    await addFirstProductToCart(page);
    await page.goto("/en/checkout");
    await fillCheckout(page);
    await page.getByTestId("pay-IDRAM").check();
    await page.getByTestId("place-order").click();
    await expect(page).toHaveURL(/\/en\/pay\/mock\//);
    await page.getByTestId("mock-approve").click();
    await expect(page).toHaveURL(/\/en\/order\/LJ-/);
    await expect(page.getByTestId("order-status")).toHaveText("Paid");
  });

  test("mock online payment: failure, then retry succeeds", async ({ page }) => {
    await addFirstProductToCart(page);
    await page.goto("/en/checkout");
    await fillCheckout(page);
    await page.getByTestId("pay-BANK_CARD").check();
    await page.getByTestId("place-order").click();
    await page.getByTestId("mock-decline").click();
    await expect(page.getByTestId("order-status")).toHaveText("Payment failed");
    await page.getByRole("button", { name: "Try paying again" }).click();
    await expect(page).toHaveURL(/\/en\/pay\/mock\//);
    await page.getByTestId("mock-approve").click();
    await expect(page.getByTestId("order-status")).toHaveText("Paid");
  });

  test("network failure during add to cart shows an error, not a crash", async ({ page }) => {
    await page.goto("/en/p/little-joe-green-apple");
    await page.route("**/*", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByText(/Connection problem/)).toBeVisible();
  });

  test("empty cart redirects checkout to cart", async ({ page }) => {
    await page.goto("/en/checkout");
    await expect(page).toHaveURL(/\/en\/cart$/);
    await expect(page.getByText("Your cart is empty.")).toBeVisible();
  });
});
