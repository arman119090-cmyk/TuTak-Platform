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
  // Same stylesheet and components as the rest of the site (design audit).
  expect(await page.locator('link[rel="stylesheet"]').count()).toBeGreaterThan(0);
  expect(await page.locator('h1').evaluate((h) => getComputedStyle(h).fontFamily)).toContain('Cormorant');
  await expect(page.locator('.site-footer__langs img.flag')).toHaveCount(6);
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
  await expect(dialog).toContainText('No interior views');
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

test.describe('enquiry via messengers (no enquiry endpoint configured)', () => {
  const WA = 'https://wa.me/37433228733';

  test('artwork page: WhatsApp, Viber, Telegram, number, Instagram as secondary', async ({ page }) => {
    await page.goto('/en/artworks/royal-dominion/');
    const box = page.locator('.artwork__contact');
    const wa = box.getByRole('link', { name: 'Write to us on WhatsApp' });
    const href = (await wa.getAttribute('href'))!;
    expect(href.startsWith(`${WA}?text=`)).toBe(true);
    expect(new URL(href).searchParams.get('text')).toContain('Royal Dominion — Lion Fountain Sculpture');
    await expect(wa).toHaveAttribute('target', '_blank');
    await expect(box.getByRole('link', { name: 'Write to us on Viber' })).toHaveAttribute('href', 'viber://chat?number=%2B37433228733');
    await expect(box.getByRole('link', { name: 'Write to us on Telegram' })).toHaveAttribute('href', 'https://t.me/+37433228733');
    await expect(box.getByText('+374 33 228 733')).toBeVisible();
    await expect(box.locator('a[href="https://instagram.com/levani__art"]')).toHaveCount(1);
    await expect(page.getByText('Price on request')).toBeVisible();
  });

  test('WhatsApp message and labels are localized', async ({ page }) => {
    await page.goto('/ru/artworks/aknuni/');
    const href = (await page.locator('.artwork__contact a[href^="https://wa.me/"]').getAttribute('href'))!;
    expect(new URL(href).searchParams.get('text')).toBe('Здравствуйте! Меня интересует работа «Aknuni / Ակնունի» из коллекции LEVANI ART.');
    await expect(page.locator('.artwork__contact').getByRole('link', { name: 'Написать нам в Telegram' })).toBeVisible();
  });

  test('enquire page shows the messengers and no form that could pretend to send', async ({ page }) => {
    await page.goto('/de/enquire/?artwork=sacred-heights-tatev');
    await expect(page.getByRole('heading', { name: 'Schreiben Sie uns' })).toBeVisible();
    await expect(page.locator('.enquiry-contact a[href^="https://wa.me/37433228733"]')).toHaveCount(1);
    await expect(page.getByText('Bitte nennen Sie: Sacred Heights — Tatev Monastery Painting')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
  });

  test('footer: messengers and number; Instagram under Follow', async ({ page }) => {
    await page.goto('/hy/');
    const footer = page.locator('footer');
    await expect(footer.getByText('Գրեք մեզ WhatsApp-ով, Viber-ով կամ Telegram-ով։')).toBeVisible();
    await expect(footer.locator('.channel')).toHaveCount(3);
    await expect(footer.getByText('+374 33 228 733')).toBeVisible();
    await expect(footer.locator('a[href="https://instagram.com/levani__art"]')).toHaveCount(1);
  });

  test('the Delabrière work is titled Deer Hunt', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.locator('.hero__caption')).toHaveText('Deer Hunt');
  });
});
