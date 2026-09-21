import { expect, test } from '@playwright/test';
import { DEMO_ADMIN, DEMO_CUSTOMER, signIn, signOutViaApi } from './helpers';

test.describe('admin panel', () => {
  test('is closed to guests and to customers', async ({ page }) => {
    await signOutViaApi(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/ru\/login/);

    await signIn(page, DEMO_CUSTOMER);
    await page.goto('/admin');
    // A customer is sent back to the storefront, not to the panel.
    await expect(page).toHaveURL(/\/ru(\/|$)/);
    await expect(page.locator('body')).not.toContainText('Дашборд');
  });

  test('admin API routes reject a customer session', async ({ page }) => {
    await signOutViaApi(page);
    await signIn(page, DEMO_CUSTOMER);
    const response = await page.request.post('/api/admin/products', { data: {} });
    expect(response.status()).toBe(403);
  });

  test('the dashboard shows turnover, orders and stock warnings', async ({ page }) => {
    await signOutViaApi(page);
    await signIn(page, DEMO_ADMIN);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
    await expect(page.getByText('Оборот всего')).toBeVisible();
    await expect(page.getByText('Средний чек')).toBeVisible();
    await expect(page.getByText('Последние заказы')).toBeVisible();
    await expect(page.getByText('Популярные товары')).toBeVisible();
  });

  test('an order status change reaches the customer account', async ({ page }) => {
    await signOutViaApi(page);
    await signIn(page, DEMO_ADMIN);
    await page.goto('/admin/orders');

    const firstOrder = page.locator('table a[href^="/admin/orders/"]').first();
    const orderNumber = (await firstOrder.innerText()).trim();
    await firstOrder.click();
    await page.waitForURL(/\/admin\/orders\//);

    // The control refuses a no-op change, so pick a status the order is not in.
    const select = page.getByRole('combobox');
    const current = await select.inputValue();
    const target = current === 'IN_PRODUCTION' ? 'READY' : 'IN_PRODUCTION';
    const targetLabel = target === 'READY' ? 'Готов' : 'В производстве';

    // Unique per run: earlier runs leave their own events on the same order.
    const marker = `E2E ${targetLabel} ${Date.now().toString(36)}`;
    await select.selectOption(target);
    await page.getByPlaceholder(/Комментарий к смене статуса/).fill(marker);
    await page.getByRole('button', { name: 'Изменить статус' }).click();

    // Assert on the status history, not on the textarea that still holds the text.
    await expect(page.getByRole('list').getByText(marker)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(targetLabel).first()).toBeVisible();

    // The same change must be visible to the customer who owns the order.
    await signOutViaApi(page);
    await signIn(page, DEMO_CUSTOMER);
    await page.goto('/ru/account/orders');
    if (await page.getByText(orderNumber).count()) {
      await page.getByText(orderNumber).first().click();
      await expect(page.getByText(targetLabel).first()).toBeVisible();
      await expect(page.getByText(marker)).toBeVisible();
    }
  });

  test('creating and editing a product really works', async ({ page }) => {
    await signOutViaApi(page);
    await signIn(page, DEMO_ADMIN);

    const suffix = Date.now().toString(36).slice(-5);
    await page.goto('/admin/products/new');
    await page.getByLabel(/^Артикул/).fill(`E2E-${suffix}`);
    await page.getByLabel(/^URL/).fill(`e2e-product-${suffix}`);
    await page.getByLabel(/^Цена, /).fill('123400');

    // Russian copy only: the editor must not demand all three languages.
    const russianBlock = page.locator('div').filter({ has: page.getByText('ru', { exact: true }) }).last();
    await russianBlock.getByLabel(/^Название/).fill(`E2E диван ${suffix}`);

    await page.getByRole('button', { name: 'Сохранить' }).click();
    // A successful create redirects to the edit route, which remounts the
    // editor and clears the "Сохранено" message — so the redirect, not the
    // message, is what proves the product was created.
    await page.waitForURL(/\/admin\/products\/[a-z0-9]+/, { timeout: 20_000 });
    // The redirect re-mounts the editor with server data; wait for it to settle
    // before typing, otherwise the edit lands on the old form instance.
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel(/^Цена, /)).toHaveValue('123400');

    // The product is now in the catalogue and searchable.
    const search = await page.request.get(`/api/search/suggest?q=E2E-${suffix}&locale=ru`);
    const data = (await search.json()) as { products: { sku: string; priceMinor: number }[] };
    expect(data.products[0]?.sku).toBe(`E2E-${suffix}`);
    expect(data.products[0]?.priceMinor).toBe(123_400);

    // Editing the price updates it.
    await page.getByLabel(/^Цена, /).fill('99900');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(/^Цена, /)).toHaveValue('99900');

    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/search/suggest?q=E2E-${suffix}&locale=ru`);
        const body = (await response.json()) as { products: { priceMinor: number }[] };
        return body.products[0]?.priceMinor;
      })
      .toBe(99_900);
  });

  test('a promo code created in the panel works in the cart', async ({ page }) => {
    await signOutViaApi(page);
    await signIn(page, DEMO_ADMIN);

    const code = `E2E${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const created = await page.request.post('/api/admin/promos', {
      data: {
        code,
        discountType: 'PERCENT',
        value: 15,
        freeDelivery: false,
        isActive: true,
        description: 'E2E',
      },
    });
    expect(created.ok()).toBeTruthy();

    const suggest = await page.request.get('/api/search/suggest?q=стул&locale=ru');
    const { products } = (await suggest.json()) as { products: { id: string; priceMinor: number }[] };
    const quote = await page.request.post('/api/cart/quote', {
      data: { items: [{ productId: products[0]!.id, quantity: 1 }], promoCode: code, locale: 'ru' },
    });
    const body = (await quote.json()) as { promoDiscountMinor: number; subtotalMinor: number };
    expect(body.promoDiscountMinor).toBe(Math.round(body.subtotalMinor * 0.15));
  });

  test('bulk import creates products from CSV', async ({ page }) => {
    await signOutViaApi(page);
    await signIn(page, DEMO_ADMIN);

    const suffix = Date.now().toString(36).slice(-5).toUpperCase();
    const csv = [
      'sku,categorySlug,brandSlug,priceMinor,stockQty,nameRu,colorKeys,materialKeys',
      `IMP-${suffix},dining-tables,tavush-oak,187900,3,"Импортированный стол ${suffix}",oak,oakSolid`,
      `BAD-${suffix},no-such-category,tavush-oak,1000,1,"Плохая строка",oak,oakSolid`,
    ].join('\n');

    const dry = await page.request.post('/api/admin/import', {
      data: { format: 'csv', payload: csv, dryRun: true },
    });
    const dryBody = (await dry.json()) as { total: number; skipped: number };
    expect(dryBody.total).toBe(2);
    expect(dryBody.skipped).toBe(1);

    const real = await page.request.post('/api/admin/import', {
      data: { format: 'csv', payload: csv, dryRun: false },
    });
    const body = (await real.json()) as { created: number; skipped: number };
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(1);

    const search = await page.request.get(`/api/search/suggest?q=IMP-${suffix}&locale=ru`);
    const found = (await search.json()) as { products: { sku: string }[] };
    expect(found.products[0]?.sku).toBe(`IMP-${suffix}`);
  });

  test('requests submitted on the site appear in the admin inbox', async ({ page }) => {
    await signOutViaApi(page);
    const marker = `E2E-${Date.now().toString(36)}`;
    const created = await page.request.post('/api/requests', {
      data: {
        type: 'KITCHEN',
        name: 'Playwright',
        phone: '+37493111222',
        comment: marker,
        locale: 'ru',
        payload: { length: 4.2, shape: 'lShaped', facade: 'matteLacquer' },
      },
    });
    expect(created.ok()).toBeTruthy();

    await signIn(page, DEMO_ADMIN);
    await page.goto('/admin/requests?type=KITCHEN');
    await expect(page.getByText(marker)).toBeVisible();
  });
});
