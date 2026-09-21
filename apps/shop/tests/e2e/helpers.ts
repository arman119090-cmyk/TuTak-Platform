import { expect, type Locator, type Page } from '@playwright/test';

export const DEMO_CUSTOMER = { email: 'demo@furniture.local', password: 'demo1234' };
export const DEMO_ADMIN = { email: 'admin@furniture.local', password: 'admin1234' };

/**
 * Streaming SSR parks late HTML chunks in a hidden staging container before
 * moving them into place, so for a few milliseconds the same form or input
 * exists twice and Playwright's strict mode sees two matches. The container
 * itself is permanent, so this waits for the actual condition — no form
 * controls left inside it — instead of for the container to disappear.
 */
export const settle = async (page: Page): Promise<void> => {
  await page.waitForLoadState('domcontentloaded');
  await page
    .waitForFunction(
      () => !document.querySelector('body > div[hidden] form, body > div[hidden] input'),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
};

/** The visible form that contains the given button. */
export const formWithButton = (page: Page, name: string): Locator =>
  page.locator('form').filter({ has: page.getByRole('button', { name }) }).first();

/** Signs in through the real form, the way a person would. */
export const signIn = async (page: Page, user: { email: string; password: string }): Promise<void> => {
  await page.goto('/ru/login');
  await settle(page);
  const form = formWithButton(page, 'Войти');
  // Labels carry a required marker ("E-mail *"), so match by prefix.
  await form.getByLabel(/^E-mail/).fill(user.email);
  await form.getByLabel(/^Пароль/).fill(user.password);
  await form.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/(ru\/account|admin)/, { timeout: 20_000 });
};

export const signOutViaApi = async (page: Page): Promise<void> => {
  await page.request.post('/api/auth/logout');
  await page.context().clearCookies();
};

/** Opens the first product card in the current listing. */
export const openFirstProduct = async (page: Page): Promise<string> => {
  await settle(page);
  const card = page.locator('article a[href*="/ru/product/"]').first();
  const href = (await card.getAttribute('href')) ?? '';
  await card.click();
  await page.waitForURL(/\/ru\/product\//);
  await settle(page);
  return href;
};

/** Asserts a listing heading is present after the page has settled. */
export const expectHeading = async (page: Page, name: string | RegExp): Promise<void> => {
  await settle(page);
  await expect(page.getByRole('heading', { name }).first()).toBeVisible();
};
