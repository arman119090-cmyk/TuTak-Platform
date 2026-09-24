import { expect, test } from '@playwright/test';

const locales = ['hy', 'ru', 'it', 'de', 'fr', 'en'];

test.describe('locale routing', () => {
  test('first visit follows the browser language', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ru-RU' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/ru$/);
    await ctx.close();
  });

  test('unsupported browser language falls back to English', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/collection');
    await expect(page).toHaveURL(/\/en\/collection$/);
    await ctx.close();
  });

  test('a remembered manual choice wins over the browser language', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ locale: 'de-DE' });
    await ctx.addCookies([{ name: 'LEVANI_LOCALE', value: 'hy', url: baseURL! }]);
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/hy$/);
    await ctx.close();
  });

  for (const l of locales) {
    test(`${l}: lang, canonical and hreflang`, async ({ page }) => {
      await page.goto(`/${l}/collection`);
      await expect(page.locator('html')).toHaveAttribute('lang', l);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/${l}/collection$`));
      const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('hreflang')),
      );
      expect(alternates.sort()).toEqual([...locales, 'x-default'].sort());
    });
  }
});

test.describe('language selector', () => {
  test('closed state is an emblem and a caret — no text, no native select', async ({ page }) => {
    await page.goto('/en');
    const trigger = page.locator('.lang__trigger');
    await expect(trigger.locator('svg')).toHaveCount(2);
    const nameWidth = await trigger.locator('.lang__name').evaluate((el) => el.getBoundingClientRect().width);
    expect(nameWidth).toBe(0);
    await expect(page.locator('header select')).toHaveCount(0);
    await expect(page.locator('img[src*="flag"], [class*="flag"]')).toHaveCount(0);
  });

  test('keyboard: open, move, Escape returns focus', async ({ page }) => {
    await page.goto('/en/about');
    const trigger = page.locator('.lang__trigger');
    await trigger.focus();
    // Keyboard focus reveals the native language name.
    await expect
      .poll(() => trigger.locator('.lang__name').evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(20);
    await page.keyboard.press('Enter');
    const items = page.getByRole('menuitemradio');
    await expect(items).toHaveCount(6);
    await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeFocused();
    await expect(page.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Home');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('choosing a language keeps the page and remembers the choice', async ({ page, context }) => {
    await page.goto('/en/artworks/aknuni');
    await page.locator('.lang__trigger').click();
    await page.getByRole('menuitemradio', { name: 'Deutsch' }).click();
    await expect(page).toHaveURL(/\/de\/artworks\/aknuni$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    const cookie = (await context.cookies()).find((c) => c.name === 'LEVANI_LOCALE');
    expect(cookie?.value).toBe('de');
  });

  test('click outside closes the menu', async ({ page }) => {
    await page.goto('/en/collection');
    await page.locator('.lang__trigger').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.click(10, 400);
    await expect(page.getByRole('menu')).toBeHidden();
  });
});
