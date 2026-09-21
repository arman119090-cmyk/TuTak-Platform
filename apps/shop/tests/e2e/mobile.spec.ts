import { expect, test } from '@playwright/test';
import { settle } from './helpers';

/**
 * Phone-viewport checks (iPhone 13 project).
 *
 * The demo is shown on a phone at least as often as on a laptop, so the mobile
 * navigation, the horizontal product rails and the checkout form get their own
 * pass rather than being assumed to work.
 */
test.describe('mobile storefront', () => {
  test('the burger menu opens the catalogue tree', async ({ page }) => {
    await page.goto('/ru');
    await settle(page);
    await page.getByRole('button', { name: 'Меню' }).click();
    // The drawer renders each root category as a <summary>; the desktop nav
    // markup is present but hidden, so target the drawer explicitly.
    await expect(page.locator('summary', { hasText: 'Диваны' })).toBeVisible();

    await page.locator('summary', { hasText: 'Кровати' }).click();
    await page.getByRole('link', { name: 'Двуспальные кровати' }).click();
    await page.waitForURL(/\/ru\/catalog\/double-beds/);
    await expect(page.getByRole('heading', { name: 'Двуспальные кровати' })).toBeVisible();
  });

  test('the mobile search leads to results', async ({ page }) => {
    await page.goto('/ru');
    await settle(page);
    await page.getByRole('button', { name: 'Поиск' }).click();
    // Two search inputs exist in the DOM (desktop + mobile); take the visible one.
    const input = page.getByPlaceholder(/Диван, дверь, артикул/).last();
    await input.fill('шкаф');
    await input.press('Enter');
    await page.waitForURL(/\/ru\/search/);
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('nothing overflows the viewport horizontally', async ({ page }) => {
    for (const path of ['/ru', '/ru/catalog/sofas', '/ru/cart', '/ru/kitchens']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
    }
  });

  test('a product can be bought from a phone', async ({ page }) => {
    await page.goto('/ru/catalog/chairs');
    await settle(page);
    await page.locator('article a[href*="/ru/product/"]').first().click();
    await page.waitForURL(/\/ru\/product\//);
    await settle(page);

    await page.getByRole('button', { name: 'В корзину' }).first().click();
    await expect(page.getByText('Товар добавлен в корзину')).toBeVisible();

    await page.goto('/ru/cart');
    await expect(page.getByRole('link', { name: 'Оформить заказ' })).toBeVisible();
    await page.getByRole('link', { name: 'Оформить заказ' }).click();
    await page.waitForURL(/\/ru\/checkout/);
    await expect(page.getByRole('heading', { name: 'Контакты' })).toBeVisible();
  });

  test('the filter drawer opens and applies a filter', async ({ page }) => {
    await page.goto('/ru/catalog/wardrobes');
    await settle(page);
    await page.getByRole('button', { name: /Фильтры/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByLabel(/Только в наличии/).click();
    await page.waitForFunction(() => window.location.search.includes('inStock=1'));
    await expect(page.getByText(/Найдено/)).toBeVisible();
  });
});
