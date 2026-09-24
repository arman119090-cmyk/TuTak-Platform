import { expect, test } from '@playwright/test';

const PRICE = /(\$|€|£|֏|₽)\s?\d|\d[\d\s.,]*\s?(USD|EUR|AMD|RUB|GBP|֏|₽|€|\$)/;

test('every sitemap URL answers 200 and shows no numerical price', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
  expect(urls.length).toBe(28 * 6);
  for (const path of urls) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const text = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, '');
    expect(text, path).not.toMatch(PRICE);
  }
});

test('images are static files that actually load — no runtime optimizer', async ({ page }) => {
  const optimizer: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/_next/image')) optimizer.push(r.url());
  });
  await page.goto('/en/collection');
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
  });
  const imgs = page.locator('.gallery img');
  await expect(imgs).toHaveCount(18);
  await expect
    .poll(() => imgs.evaluateAll((els) => els.filter((i) => !(i as HTMLImageElement).complete || !(i as HTMLImageElement).naturalWidth).length))
    .toBe(0);
  const srcs = await imgs.evaluateAll((els) => els.map((i) => (i as HTMLImageElement).currentSrc));
  expect(srcs.every((s) => /\/artworks\/_w\/\d+\//.test(s))).toBe(true);
  expect(optimizer).toEqual([]);
});

test('home header starts transparent over the hero', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('header.site-header')).toHaveAttribute('data-over-hero', 'true');
});

test('unknown paths 404 in the right language', async ({ page }) => {
  const res = await page.goto('/fr/nope');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ne fait pas partie');
  await expect(page.getByRole('link', { name: 'Retour à la collection' })).toHaveAttribute('href', '/fr/collection/');
});

test('artwork page renders only known facts', async ({ page }) => {
  await page.goto('/en/artworks/sacred-heights-tatev');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sacred Heights — Tatev Monastery Painting');
  const labels = await page.locator('.facts dt').allTextContents();
  expect(labels).toEqual(['Dimensions', 'Category']);
  await expect(page.getByText('Price on request')).toBeVisible();
  await expect(page.getByRole('button', { name: 'View in an Interior' })).toBeVisible();
});

test('attributed work links its artist', async ({ page }) => {
  await page.goto('/en/artworks/edouard-delabriere-hunter');
  await expect(page.locator('.facts dt')).toHaveText(['Artist', 'Dimensions', 'Category']);
  await expect(page.locator('.facts dd a')).toHaveText('Édouard Delabrière');
});

test('interior preview opens as a dialog and closes on Escape', async ({ page }) => {
  await page.goto('/en/artworks/aknuni');
  await page.getByRole('button', { name: 'View in an Interior' }).click();
  const dialog = page.locator('dialog.interior');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('in preparation');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('search finds works like an archive', async ({ page }) => {
  await page.goto('/en');
  await page.getByRole('button', { name: 'Search the collection' }).click();
  await page.getByLabel('Search by title, artist or category').fill('fountain');
  await expect(page.locator('.search__row')).toHaveCount(3);
  await page.locator('.search__row').first().click();
  await expect(page).toHaveURL(/\/en\/artworks\//);
});

test('collection filters are links with their own URLs', async ({ page }) => {
  await page.goto('/en/collection');
  await expect(page.locator('.gallery > li')).toHaveCount(18);
  await page.locator('.filters').getByRole('link', { name: /Paintings/ }).click();
  await expect(page).toHaveURL(/\/en\/collection\/paintings\/?$/);
  await expect(page.locator('.gallery > li')).toHaveCount(6);
});

test.describe('enquiry via Instagram (no enquiry endpoint configured)', () => {
  test('artwork page offers Instagram, opening in a new tab', async ({ page }) => {
    await page.goto('/en/artworks/royal-dominion/');
    const cta = page.getByRole('link', { name: /Enquire via Instagram/ });
    await expect(cta).toHaveAttribute('href', 'https://www.instagram.com/levani__art/');
    await expect(cta).toHaveAttribute('target', '_blank');
    await expect(page.getByText('Please mention the title of the work')).toBeVisible();
    await expect(page.getByText('Price on request')).toBeVisible();
  });

  test('CTA is localized', async ({ page }) => {
    await page.goto('/ru/artworks/aknuni/');
    await expect(page.getByRole('link', { name: /Запрос через Instagram/ })).toBeVisible();
  });

  test('enquire page shows the Instagram channel and no form that could pretend to send', async ({ page }) => {
    await page.goto('/de/enquire/?artwork=sacred-heights-tatev');
    await expect(page.getByRole('heading', { name: 'Schreiben Sie uns auf Instagram' })).toBeVisible();
    await expect(page.getByRole('link', { name: /@levani__art/ })).toHaveAttribute('href', 'https://www.instagram.com/levani__art/');
    await expect(page.getByText('Bitte nennen Sie: Sacred Heights — Tatev Monastery Painting')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
  });

  test('footer links Instagram', async ({ page }) => {
    await page.goto('/hy/');
    await expect(page.locator('footer a[href="https://www.instagram.com/levani__art/"]')).toHaveCount(1);
  });
});
