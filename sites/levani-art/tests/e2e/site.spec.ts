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

test('unknown paths 404 in the right language', async ({ page }) => {
  const res = await page.goto('/fr/nope');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ne fait pas partie');
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
  await expect(page).toHaveURL(/\/en\/collection\/paintings$/);
  await expect(page.locator('.gallery > li')).toHaveCount(6);
});

test.describe('enquiry', () => {
  test('artwork and reason arrive preselected', async ({ page }) => {
    await page.goto('/en/artworks/royal-dominion');
    await page.getByRole('link', { name: 'Request private viewing' }).click();
    await expect(page).toHaveURL(/artwork=royal-dominion&reason=viewing/);
    await expect(page.getByLabel('Artwork')).toHaveValue('royal-dominion');
    await expect(page.getByLabel('Private viewing')).toBeChecked();
  });

  test('validates in the visitor language', async ({ page }) => {
    await page.goto('/de/enquire');
    await page.getByRole('button', { name: 'Anfrage senden' }).click();
    await expect(page.getByText('Bitte füllen Sie dieses Feld aus.').first()).toBeVisible();
    await expect(page.getByLabel('Name')).toBeFocused();
    await page.getByLabel('E-Mail').fill('not-an-email');
    await page.getByRole('button', { name: 'Anfrage senden' }).click();
    await expect(page.getByText('Bitte geben Sie eine gültige E-Mail-Adresse ein.')).toBeVisible();
  });

  test('without a configured transport it says so instead of pretending', async ({ page }) => {
    await page.goto('/en/enquire?artwork=aknuni');
    await page.getByLabel('Name').fill('Test Visitor');
    await page.getByLabel('Email').fill('visitor@example.com');
    await page.getByLabel('Message').fill('A question about this painting.');
    await page.locator('input[name="consent"]').check();
    await page.waitForTimeout(2600); // the form rejects sub-human fill times
    await page.getByRole('button', { name: 'Send enquiry' }).click();
    await expect(page.locator('.enquiry__error')).toContainText('not connected yet');
  });
});

test.describe('api', () => {
  test('rejects invalid payloads with field errors', async ({ request }) => {
    const res = await request.post('/api/enquiry', {
      data: { name: '', email: 'x', startedAt: 0 },
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).fields).toMatchObject({ name: 'required', email: 'email' });
  });

  test('a filled honeypot is quietly accepted and dropped', async ({ request }) => {
    const res = await request.post('/api/enquiry', {
      data: { website: 'spam.example', name: 'x' },
      headers: { 'x-forwarded-for': '10.0.0.2' },
    });
    expect(res.status()).toBe(200);
  });

  test('rate limits a burst from one address', async ({ request }, info) => {
    const ip = `10.0.1.${info.project.name.length}`; // one address per project
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await request.post('/api/enquiry', { data: {}, headers: { 'x-forwarded-for': ip } });
      statuses.push(res.status());
    }
    expect(statuses.slice(0, 5).every((s) => s === 422)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
