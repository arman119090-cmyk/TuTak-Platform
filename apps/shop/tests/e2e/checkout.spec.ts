import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, openFirstProduct, settle, signIn, signOutViaApi } from './helpers';

const addSomethingToCart = async (page: Page): Promise<void> => {
  await page.goto('/ru/catalog/tables');
  await openFirstProduct(page);
  await page.getByRole('button', { name: 'В корзину' }).first().click();
  await expect(page.getByText('Товар добавлен в корзину')).toBeVisible();
};

const fillCheckoutUpToPayment = async (page: Page): Promise<void> => {
  await settle(page);
  await page.getByLabel(/^Имя/).fill('Тест');
  await page.getByLabel(/^Фамилия/).fill('Тестов');
  await page.getByLabel(/^Телефон/).fill('+37493000000');
  await page.getByLabel(/^E-mail/).fill('test@example.am');
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('heading', { name: 'Адрес' })).toBeVisible();
  await page.getByLabel(/^Улица/).fill('пр. Маштоца');
  await page.getByLabel(/^Дом/).fill('42');
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('heading', { name: 'Доставка' })).toBeVisible();
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('heading', { name: 'Дополнительные услуги' })).toBeVisible();
  await page.getByLabel(/Сборка мебели/).check();
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('heading', { name: 'Способ оплаты' })).toBeVisible();
};

test.describe('cart and checkout', () => {
  test.beforeEach(async ({ page }) => {
    await signOutViaApi(page);
  });

  test('the cart recalculates quantity and applies a promo code', async ({ page }) => {
    await addSomethingToCart(page);
    await page.goto('/ru/cart');
    await settle(page);

    const total = page.locator('dd').last();
    const before = Number((await total.innerText()).replace(/[^\d]/g, ''));

    await page.getByRole('button', { name: '+' }).click();
    await expect
      .poll(async () => Number((await total.innerText()).replace(/[^\d]/g, '')))
      .toBeGreaterThan(before);

    await page.getByPlaceholder('Промокод').fill('DEMO25');
    await page.getByRole('button', { name: 'Применить' }).click();
    await expect(page.getByText(/Промокод DEMO25 применён/)).toBeVisible();
    await expect(page.getByText('Промокод', { exact: true })).toBeVisible();
  });

  test('an unknown promo code is rejected with a message', async ({ page }) => {
    await addSomethingToCart(page);
    await page.goto('/ru/cart');
    await page.getByPlaceholder('Промокод').fill('NOPE404');
    await page.getByRole('button', { name: 'Применить' }).click();
    await expect(page.getByText(/не найден или истёк/)).toBeVisible();
  });

  test('an expired promo code is rejected', async ({ page }) => {
    await addSomethingToCart(page);
    await page.goto('/ru/cart');
    await page.getByPlaceholder('Промокод').fill('EXPIRED');
    await page.getByRole('button', { name: 'Применить' }).click();
    await expect(page.getByText(/не найден или истёк/)).toBeVisible();
  });

  test('a declined card keeps the customer on the payment step', async ({ page }) => {
    await addSomethingToCart(page);
    await page.goto('/ru/checkout');
    await fillCheckoutUpToPayment(page);

    await page.getByRole('button', { name: 'Смоделировать отказ банка' }).click();
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click();

    await expect(page.getByText(/Банк отклонил операцию/)).toBeVisible();
    await expect(page).toHaveURL(/\/ru\/checkout$/);
  });

  test('a full order goes through and lands in the customer account', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER);
    await addSomethingToCart(page);

    await page.goto('/ru/cart');
    await page.getByPlaceholder('Промокод').fill('WELCOME10');
    await page.getByRole('button', { name: 'Применить' }).click();
    await page.getByRole('link', { name: 'Оформить заказ' }).click();

    await page.waitForURL(/\/ru\/checkout/);
    await fillCheckoutUpToPayment(page);
    await page.getByRole('button', { name: 'Провести успешную оплату' }).click();
    await page.getByRole('button', { name: 'Далее' }).click();

    await expect(page.getByRole('heading', { name: 'Проверьте заказ' })).toBeVisible();
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click();

    await page.waitForURL(/\/ru\/checkout\/success/, { timeout: 30_000 });
    const heading = await page.getByRole('heading', { level: 1 }).innerText();
    const number = heading.match(/ORD-\d{4}-\d+/)?.[0];
    expect(number).toBeTruthy();

    // The same order must be visible in the customer's own account.
    await page.goto('/ru/account/orders');
    await expect(page.getByText(number!)).toBeVisible();
  });

  test('the server, not the browser, decides the price', async ({ request }) => {
    const suggest = await request.get('/api/search/suggest?q=диван&locale=ru');
    const { products } = (await suggest.json()) as { products: { id: string; priceMinor: number }[] };
    const product = products[0]!;

    // The quote endpoint is given a quantity only — there is no price field to
    // tamper with, and the amount comes back from the catalogue.
    const quote = await request.post('/api/cart/quote', {
      data: { items: [{ productId: product.id, quantity: 2 }], locale: 'ru' },
    });
    const body = (await quote.json()) as { subtotalMinor: number; lines: { unitPriceMinor: number }[] };
    expect(body.lines[0]!.unitPriceMinor).toBe(product.priceMinor);
    expect(body.subtotalMinor).toBe(product.priceMinor * 2);

    // An order for a product that does not exist cannot be created.
    const checkout = await request.post('/api/checkout', {
      data: {
        items: [{ productId: 'does-not-exist', quantity: 1 }],
        locale: 'ru',
        contacts: { firstName: 'Тест', lastName: '', phone: '+37493000000', email: 'a@b.am' },
        delivery: { method: 'PICKUP', hasLift: true },
        services: {},
        payment: { method: 'CASH' },
      },
    });
    expect(checkout.status()).toBe(400);
  });
});
