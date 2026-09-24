import { expect, test } from '@playwright/test';

const locales = ['hy', 'ru', 'it', 'de', 'fr', 'en'];

test.describe('locale routing', () => {
  test('first visit follows the browser language', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ru-RU' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/ru\/?$/);
    await ctx.close();
  });

  test('unsupported browser language falls back to English', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/en\/?$/);
    await ctx.close();
  });

  test('a remembered manual choice wins over the browser language', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ locale: 'de-DE' });
    await ctx.addCookies([{ name: 'LEVANI_LOCALE', value: 'hy', url: baseURL! }]);
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/hy\/?$/);
    await ctx.close();
  });

  for (const l of locales) {
    test(`${l}: lang, canonical and hreflang`, async ({ page }) => {
      await page.goto(`/${l}/collection`);
      await expect(page.locator('html')).toHaveAttribute('lang', l);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/${l}/collection/$`));
      const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('hreflang')),
      );
      expect(alternates.sort()).toEqual([...locales, 'x-default'].sort());
    });
  }
});

test.describe('language selector', () => {
  test('closed state is the flag and a caret — no text, no native select', async ({ page }) => {
    await page.goto('/en');
    const trigger = page.locator('.lang__trigger');
    await expect(trigger.locator('img.flag')).toHaveAttribute('src', '/flags/gb.svg');
    await expect(trigger.locator('.lang__caret svg')).toHaveCount(1);
    // The flag must actually load (not a broken image).
    const loaded = await trigger.locator('img.flag').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    expect(loaded).toBe(true);
    const nameWidth = await trigger.locator('.lang__name').evaluate((el) => el.getBoundingClientRect().width);
    expect(nameWidth).toBe(0);
    await expect(page.locator('header select')).toHaveCount(0);
    // Flags only: the old coat-of-arms images are gone.
    await expect(page.locator('img[src*="/emblems/"]')).toHaveCount(0);
  });

  test('every language shows its own flag', async ({ page }) => {
    await page.goto('/en/about');
    await page.locator('.lang__trigger').click();
    const expected: Record<string, string> = {
      'Հայերեն': 'am', 'Русский': 'ru', 'Italiano': 'it', 'Deutsch': 'de', 'Français': 'fr', 'English': 'gb',
    };
    for (const [name, code] of Object.entries(expected)) {
      const img = page.getByRole('menuitemradio', { name }).locator('img.flag');
      await expect(img).toHaveAttribute('src', `/flags/${code}.svg`);
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    }
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
    await expect(page).toHaveURL(/\/de\/artworks\/aknuni\/?$/);
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

test.describe('header layout', () => {
  // Found in the design audit: at 1200 px de/ru/it overflowed; Armenian
  // was collapsed at 1440 while every other language showed the full nav.
  for (const [locale, width] of [['de', 1280], ['ru', 1280], ['it', 1280], ['fr', 1280], ['en', 1280], ['hy', 1440]] as const) {
    test(`${locale} at ${width}px: full nav shown and nothing overflows`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${locale}/collection/`);
      await expect(page.locator('.site-nav')).toBeVisible();
      await expect(page.locator('.site-header__enquire')).toBeVisible();
      expect(await page.locator('.site-nav ul').evaluate((u) => u.scrollWidth - u.clientWidth)).toBeLessThanOrEqual(0);
      const nav = (await page.locator('.site-nav ul').boundingBox())!;
      const tools = (await page.locator('.site-header__tools').boundingBox())!;
      expect(nav.x + nav.width).toBeLessThan(tools.x);
    });
  }
});
