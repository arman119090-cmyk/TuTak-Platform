import { expect, test } from '@playwright/test';
import { DEMO_ADMIN, settle, signIn, signOutViaApi } from './helpers';

test.describe('kitchen calculator', () => {
  test('estimates a kitchen live and files a request the admin can see', async ({ page }) => {
    await signOutViaApi(page);
    await page.goto('/ru/kitchens');
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Рассчитать кухню' })).toBeVisible();

    const estimate = page.locator('aside .text-\\[28px\\]');
    const before = Number((await estimate.innerText()).replace(/[^\d]/g, ''));

    // A longer, more complex kitchen must cost more.
    await page.getByRole('button', { name: 'П-образная' }).click();
    await page.locator('input[inputmode="decimal"]').fill('6');
    await page.locator('input[inputmode="decimal"]').blur();
    await expect
      .poll(async () => Number((await estimate.innerText()).replace(/[^\d]/g, '')))
      .toBeGreaterThan(before);

    const marker = `Кухня E2E ${Date.now().toString(36)}`;
    await page.getByLabel(/^Комментарий/).fill(marker);
    await page.getByLabel(/^Имя/).fill('Playwright');
    await page.getByLabel(/^Телефон/).fill('+37493222333');
    await page.getByRole('button', { name: 'Отправить заявку' }).click();

    await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();

    await signIn(page, DEMO_ADMIN);
    await page.goto('/admin/requests?type=KITCHEN');
    await expect(page.getByText(marker)).toBeVisible();
  });

  test('the measurement request form works from the kitchens page', async ({ page }) => {
    await signOutViaApi(page);
    await page.goto('/ru/kitchens');
    await settle(page);
    await page.getByRole('button', { name: 'Заказать замер' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('dialog').getByLabel(/^Имя/).fill('Playwright');
    await page.getByRole('dialog').getByLabel(/^Телефон/).fill('+37493444555');
    await page.getByRole('dialog').getByRole('button', { name: 'Отправить' }).click();
    await expect(page.getByText('Спасибо')).toBeVisible();
  });

  test('an invalid phone number is rejected by the server', async ({ request }) => {
    const response = await request.post('/api/requests', {
      data: { type: 'CALLBACK', name: 'Тест', phone: '12345', locale: 'ru', payload: {} },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe('invalid_phone');
  });
});

test.describe('door configurator', () => {
  test('recalculates the price and adds the configured set to the cart', async ({ page }) => {
    await signOutViaApi(page);
    await page.goto('/ru/catalog/interior-doors');
    await settle(page);
    await page.locator('article a[href*="/ru/product/"]').first().click();
    await page.waitForURL(/\/ru\/product\//);
    await settle(page);

    await expect(page.getByRole('heading', { name: 'Конфигуратор двери' })).toBeVisible();
    const total = page.getByText(/Итого за комплект/).locator('xpath=following-sibling::dd[1]');
    const before = Number((await total.innerText()).replace(/[^\d]/g, ''));

    // Upgrading the finish and adding installation must raise the total.
    await page.getByRole('button', { name: /Натуральный шпон/ }).click();
    await page.getByRole('button', { name: /Установка с демонтажом/ }).click();
    await expect
      .poll(async () => Number((await total.innerText()).replace(/[^\d]/g, '')))
      .toBeGreaterThan(before);

    const configured = Number((await total.innerText()).replace(/[^\d]/g, ''));

    await page.getByRole('button', { name: 'В корзину с комплектацией' }).click();
    await expect(page.getByText('Товар добавлен в корзину')).toBeVisible();

    await page.goto('/ru/cart');
    await expect(page.getByText(/Конфигуратор двери/)).toBeVisible();

    // The cart total is the server's recalculation of the same configuration.
    const cartTotal = page.locator('dd').last();
    await expect
      .poll(async () => Number((await cartTotal.innerText()).replace(/[^\d]/g, '')))
      .toBe(configured);
  });

  test('the server refuses a door option that does not exist', async ({ request }) => {
    const suggest = await request.get('/api/search/suggest?q=дверь межкомнатная&locale=ru');
    const { products } = (await suggest.json()) as { products: { id: string; priceMinor: number }[] };
    const door = products[0]!;

    const quote = await request.post('/api/cart/quote', {
      data: {
        items: [
          {
            productId: door.id,
            quantity: 1,
            doorConfig: { size: '800x2000', coating: 'unobtainium', color: 'oak', opening: 'left' },
          },
        ],
        locale: 'ru',
      },
    });
    const body = (await quote.json()) as { warnings: string[]; lines: { unitPriceMinor: number }[] };
    expect(body.warnings.some((warning) => warning.includes('unknown_door_option'))).toBe(true);
    // The bogus finish contributes nothing to the price.
    expect(body.lines[0]!.unitPriceMinor).toBe(door.priceMinor + 8_000 + 6_000);
  });
});
