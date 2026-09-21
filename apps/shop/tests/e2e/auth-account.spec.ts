import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, formWithButton, settle, signIn, signOutViaApi } from './helpers';

test.describe('accounts', () => {
  test.beforeEach(async ({ page }) => {
    await signOutViaApi(page);
  });

  test('a customer signs in, sees orders and signs out', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER);
    await expect(page.getByRole('heading', { name: /Здравствуйте/ })).toBeVisible();

    await page.getByRole('link', { name: 'Мои заказы' }).click();
    await page.waitForURL(/\/ru\/account\/orders/);
    await expect(page.getByText(/ORD-/).first()).toBeVisible();

    await page.getByText(/ORD-/).first().click();
    await expect(page.getByText('Состав заказа')).toBeVisible();
    await expect(page.getByText('История статусов')).toBeVisible();

    await page.getByRole('button', { name: 'Выйти' }).click();
    await page.waitForURL(/\/ru$/);
    await expect(page.getByRole('link', { name: 'Войти' })).toBeVisible();
  });

  test('wrong credentials are refused without saying which field was wrong', async ({ page }) => {
    await page.goto('/ru/login');
    await settle(page);
    const form = formWithButton(page, 'Войти');
    await form.getByLabel(/^E-mail/).fill(DEMO_CUSTOMER.email);
    await form.getByLabel(/^Пароль/).fill('definitely-not-the-password');
    await form.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText('Неверный e-mail или пароль')).toBeVisible();
    await expect(page).toHaveURL(/\/ru\/login/);
  });

  test('the account area is closed to guests', async ({ page }) => {
    await page.goto('/ru/account/orders');
    await expect(page).toHaveURL(/\/ru\/login/);
  });

  test('an order that is not yours is not found', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER);
    // Order lookups are scoped by user id, so a guessed number resolves to 404
    // rather than to somebody else's order.
    await page.goto('/ru/account/orders/ORD-9999-0001');
    await expect(page.getByText('Страница не найдена')).toBeVisible();
  });

  test('registration creates an account and signs the person in', async ({ page }) => {
    const email = `e2e-${Date.now().toString(36)}@example.am`;
    await page.goto('/ru/register');
    await settle(page);
    const form = formWithButton(page, 'Создать аккаунт');
    await form.getByLabel(/^Имя/).fill('Тест');
    await form.getByLabel(/^E-mail/).fill(email);
    await form.getByLabel(/^Пароль/).fill('demo12345');
    await form.getByLabel(/^Повторите пароль/).fill('demo12345');
    await form.getByRole('button', { name: 'Создать аккаунт' }).click();

    await page.waitForURL(/\/ru\/account/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /Здравствуйте, Тест/ })).toBeVisible();
  });

  test('the DEMO phone login accepts the documented code', async ({ page }) => {
    await page.goto('/ru/login');
    await settle(page);
    await page.getByRole('button', { name: 'Вход по телефону' }).click();
    const form = formWithButton(page, 'Получить код');
    await form.getByLabel(/^Телефон/).fill('+37493999888');
    await form.getByRole('button', { name: 'Получить код' }).click();
    await expect(page.getByText(/код всегда 111111/)).toBeVisible();

    const otpForm = formWithButton(page, 'Подтвердить');
    await otpForm.getByLabel(/Введите код/).fill('111111');
    await otpForm.getByRole('button', { name: 'Подтвердить' }).click();
    await page.waitForURL(/\/ru\/account/, { timeout: 20_000 });
  });

  test('a saved address appears in the account', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER);
    await page.goto('/ru/account/addresses');
    await settle(page);
    await page.getByRole('button', { name: 'Добавить адрес' }).click();

    const label = `E2E ${Date.now().toString(36)}`;
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Название адреса/).fill(label);
    await dialog.getByLabel(/^Город/).fill('Кентрон');
    await dialog.getByLabel(/^Улица/).fill('ул. Тестовая');
    await dialog.getByLabel(/^Дом/).fill('7');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();

    await expect(page.getByText(label)).toBeVisible({ timeout: 15_000 });
  });
});
