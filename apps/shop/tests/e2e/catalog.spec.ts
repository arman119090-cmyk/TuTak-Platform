import { expect, test } from '@playwright/test';
import { openFirstProduct, settle } from './helpers';

test.describe('catalogue', () => {
  test('the homepage shows the storefront with products', async ({ page }) => {
    await page.goto('/ru');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
    // Generated artwork must actually load, not 404.
    const image = page.locator('img[src^="/media/art/"]').first();
    await expect(image).toBeVisible();
    const response = await page.request.get((await image.getAttribute('src')) ?? '');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
  });

  test('a bare URL redirects to a language-prefixed one', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/(ru|hy|en)$/);
  });

  test('a category page lists products and its subcategories', async ({ page }) => {
    await page.goto('/ru/catalog/sofas');
    await expect(page.getByRole('heading', { name: 'Диваны' })).toBeVisible();
    await expect(page.getByText(/Найдено/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Угловые диваны/ })).toBeVisible();
    await expect(page.locator('article')).not.toHaveCount(0);
  });

  test('filtering narrows the result count and survives a reload', async ({ page }) => {
    await page.goto('/ru/catalog/sofas');
    await settle(page);
    const countText = await page
      .getByText(/Найдено/)
      .first()
      .innerText();
    const before = Number(countText.replace(/\D/g, ''));

    // The panel updates the URL and the server re-renders, so assert on the
    // state rather than expecting the click to be synchronous.
    const sidebar = page.locator('aside').first();
    await sidebar.getByLabel(/Только в наличии/).click();
    await expect(sidebar.getByLabel(/Только в наличии/)).toBeChecked();
    await page.waitForFunction(() => window.location.search.includes('inStock=1'));

    const afterText = await page
      .getByText(/Найдено/)
      .first()
      .innerText();
    const after = Number(afterText.replace(/\D/g, ''));
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(0);

    await page.reload();
    await settle(page);
    await expect(
      page
        .locator('aside')
        .first()
        .getByLabel(/Только в наличии/),
    ).toBeChecked();
  });

  test('sorting by price puts the cheapest product first', async ({ page }) => {
    await page.goto('/ru/catalog/chairs?sort=price-asc');
    const prices = await page.locator('article .tabular-nums').allInnerTexts();
    const numbers = prices
      .map((text) => Number(text.replace(/[^\d]/g, '')))
      .filter((value) => value > 1000);
    expect(numbers.length).toBeGreaterThan(1);
    expect(numbers[0]).toBeLessThanOrEqual(numbers[numbers.length - 1]!);
  });

  test('search finds products by a natural query', async ({ page }) => {
    await page.goto('/ru');
    const search = page.getByPlaceholder(/Диван, дверь, артикул/);
    await search.fill('серый диван');
    await page.waitForResponse((response) => response.url().includes('/api/search/suggest'));
    await expect(page.getByText('Товары', { exact: true })).toBeVisible();
    await search.press('Enter');
    await page.waitForURL(/\/ru\/search/);
    await expect(page.locator('article')).not.toHaveCount(0);
  });

  test('search by SKU finds the exact product', async ({ page }) => {
    const response = await page.request.get('/api/search/suggest?q=SF-COR&locale=ru');
    const data = (await response.json()) as { products: { sku: string }[] };
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.products[0]!.sku).toContain('SF-COR');
  });

  test('a product page shows price, specs and reviews', async ({ page }) => {
    await page.goto('/ru/catalog/sofas');
    await openFirstProduct(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/Артикул/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'В корзину' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Характеристики' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Отзывы' })).toBeVisible();
    // Product and breadcrumb structured data for search engines.
    const jsonLd = (await page.locator('script[type="application/ld+json"]').allInnerTexts()).join(
      '',
    );
    expect(jsonLd).toContain('"@type":"Product"');
    expect(jsonLd).toContain('"@type":"BreadcrumbList"');
  });

  test('choosing a paid option raises the displayed price', async ({ page }) => {
    await page.goto('/ru/catalog/sofas');
    await openFirstProduct(page);
    const priceLocator = page.locator('.text-\\[26px\\]').first();
    const before = Number((await priceLocator.innerText()).replace(/[^\d]/g, ''));
    const paidOption = page.locator('button', { hasText: /^\+\s?\d/ }).first();
    if (await paidOption.count()) {
      await paidOption.click();
      const after = Number((await priceLocator.innerText()).replace(/[^\d]/g, ''));
      expect(after).toBeGreaterThan(before);
    }
  });

  test('adding to the cart updates the header counter and survives a reload', async ({ page }) => {
    await page.goto('/ru/catalog/beds');
    await openFirstProduct(page);
    await page.getByRole('button', { name: 'В корзину' }).first().click();
    await expect(page.getByText('Товар добавлен в корзину')).toBeVisible();

    await page.reload();
    const cartLink = page.getByRole('link', { name: 'Корзина' });
    await expect(cartLink).toContainText('1');

    await cartLink.click();
    await expect(page).toHaveURL(/\/ru\/cart/);
    await expect(page.getByRole('button', { name: 'Применить' })).toBeVisible();
  });

  test('the wishlist and the comparison keep what was added', async ({ page }) => {
    await page.goto('/ru/catalog/chairs');
    await openFirstProduct(page);
    // Scope to the buy box: product cards further down the page repeat these.
    const buyBox = page.locator('h1').locator('xpath=ancestor::div[1]');
    await buyBox.getByRole('button', { name: 'В избранное' }).click();
    await buyBox.getByRole('button', { name: 'Сравнить' }).click();

    await page.goto('/ru/favorites');
    await expect(page.locator('article').first()).toBeVisible();

    await page.goto('/ru/compare');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByLabel('Только отличия')).toBeVisible();
  });

  test('the language switcher translates the interface', async ({ page }) => {
    await page.goto('/ru/catalog/sofas');
    await page.getByRole('button', { name: 'hy', exact: true }).click();
    await page.waitForURL(/\/hy\/catalog\/sofas/);
    await expect(page.getByRole('heading', { name: 'Բազմոցներ' })).toBeVisible();

    await page.getByRole('button', { name: 'en', exact: true }).click();
    await page.waitForURL(/\/en\/catalog\/sofas/);
    await expect(page.getByRole('heading', { name: 'Sofas' })).toBeVisible();
  });

  test('the shop name is written in the language of the page', async ({ page }) => {
    const names = { hy: 'Հովիկի Մեբել', ru: 'Ховики Мебель', en: 'Hoviki Mebel' };
    for (const [locale, name] of Object.entries(names)) {
      await page.goto(`/${locale}`);
      await settle(page);
      // The wordmark is upper-cased by CSS, so match the accessible name of
      // the logo link instead of the rendered glyphs.
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
      for (const other of Object.values(names).filter((value) => value !== name)) {
        await expect(page.getByText(other, { exact: true })).toHaveCount(0);
      }
    }
  });
});
