import { expect, test } from '@playwright/test';

test.describe('mobile', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'phone-only behaviour');

  test('tapping the emblem opens the language sheet', async ({ page }) => {
    await page.goto('/ru');
    await page.locator('.lang__trigger').tap();
    const panel = page.getByRole('menu');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(840); // anchored to the bottom
    await page.getByRole('menuitemradio', { name: 'Italiano' }).tap();
    await expect(page).toHaveURL(/\/it\/?$/);
  });

  test('the sheet stays anchored to the screen after scrolling', async ({ page }) => {
    await page.goto('/en/collection');
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    await page.locator('.lang__trigger').tap();
    const box = await page.getByRole('menu').boundingBox();
    expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(840);
  });

  test('menu is a full-screen index with language access', async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('button', { name: 'Open menu' }).tap();
    const menu = page.locator('dialog.mobile-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: /Private Clients/ })).toBeVisible();
    await expect(menu.locator('.mobile-menu__langs a')).toHaveCount(6);
    await menu.getByRole('link', { name: /About/ }).tap();
    await expect(page).toHaveURL(/\/en\/about\/?$/);
  });

  for (const path of ['/hy', '/de/collection', '/ru/artworks/royal-dominion', '/fr/enquire', '/it/private-clients']) {
    test(`no horizontal scroll on ${path}`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
