import { expect, test, type Page } from '@playwright/test';
import source from '../../src/content/catalog.source.json';

const LOCALES = ['hy', 'ru', 'it', 'de', 'fr', 'en'] as const;
const EMBLEM: Record<string, string> = { hy: 'am', ru: 'ru', it: 'it', de: 'de', fr: 'fr', en: 'gb' };
const NAMES: Record<string, string> = {
  hy: 'Հայերեն', ru: 'Русский', it: 'Italiano', de: 'Deutsch', fr: 'Français', en: 'English',
};
// The owner's messengers — one number (+374 33 228 733).
const WA = 'https://wa.me/37433228733';
const VIBER = 'viber://chat?number=%2B37433228733';
const TELEGRAM = 'https://t.me/+37433228733';
const NUMBER = '+374 33 228 733';

/** WhatsApp, Viber and Telegram links inside `scope`, with the number shown. */
async function expectMessengers(scope: ReturnType<Page['locator']>, whatsappMustMention?: string) {
  const wa = scope.locator(`a[href^="${WA}"]`).first();
  await expect(wa).toHaveCount(1);
  if (whatsappMustMention) {
    const text = new URL((await wa.getAttribute('href'))!).searchParams.get('text') ?? '';
    expect(text).toContain(whatsappMustMention);
  }
  await expect(scope.locator(`a[href="${VIBER}"]`).first()).toHaveCount(1);
  await expect(scope.locator(`a[href="${TELEGRAM}"]`).first()).toHaveCount(1);
  await expect(scope.getByText(NUMBER, { exact: true }).first()).toBeVisible();
}
const PRICE_ON_REQUEST: Record<string, string> = {
  hy: 'Գինը՝ հարցմամբ', ru: 'Цена по запросу', it: 'Prezzo su richiesta',
  de: 'Preis auf Anfrage', fr: 'Prix sur demande', en: 'Price on request',
};
const IG = 'https://instagram.com/levani__art';
const PRICE = /(\$|€|£|֏|₽)\s?\d|\d[\d\s.,]*\s?(USD|EUR|AMD|RUB|GBP|֏|₽|€|\$)/;
// Copy that would suggest a form or an unconfirmed service (all 6 languages).
const NO_FORM_OR_SERVICE =
  /enquiry form|contact form|send enquiry|Art Advisor|Kunstberater|арт-консультант|conseiller artistique|consulente d.arte|արվեստի խորհրդատու|placement, access|installation before|in preparation|in Vorbereitung|готовятся|en préparation|in preparazione|Anfrageformular|формой запроса|formulaire de demande|modulo di richiesta|հարցման ձև|private viewing|частный показ|Private Besichtigung|visite privée|visione privata|մասնավոր դիտում/i;
const isDesktop = (p: Page) => (p.viewportSize()?.width ?? 0) > 500;

/** Collects every request to the old runtime optimizer, per page. */
function watchOptimizer(page: Page) {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/_next/image')) hits.push(r.url());
  });
  return hits;
}

async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
  });
}

async function brokenImages(page: Page) {
  // Rendered images only: lazy images inside display:none (e.g. category
  // thumbnails on phones, closed menus) are correctly never fetched.
  return page.locator('img').evaluateAll((imgs) =>
    imgs
      .filter((i) => i.getClientRects().length > 0)
      .filter((i) => !(i as HTMLImageElement).complete || (i as HTMLImageElement).naturalWidth === 0)
      .map((i) => (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src),
  );
}

test('Delabrière work is titled "Deer Hunt" everywhere', async ({ page }) => {
  await page.goto('/en/artworks/edouard-delabriere-hunter/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Deer Hunt');
  await page.goto('/ru/');
  await expect(page.locator('.hero__caption')).toHaveText('Deer Hunt');
  expect(await page.content()).not.toContain('Hunter with Dogs');
});

test('root / sends the visitor to a language', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/(hy|ru|it|de|fr|en)\/$/);
});

for (const l of LOCALES) {
  test(`${l}: home — lang, SEO, emblem, images, no overflow, no /_next/image`, async ({ page }) => {
    const hits = watchOptimizer(page);
    const res = await page.goto(`/${l}/`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', l);
    await expect(page).toHaveTitle(/LEVANI ART/);
    const base = new URL(page.url()).origin;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${base}/${l}/`);
    const alt = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((e) =>
      e.map((x) => `${x.getAttribute('hreflang')} ${x.getAttribute('href')}`),
    );
    expect(alt.length).toBe(7);
    for (const o of LOCALES) expect(alt).toContain(`${o} ${base}/${o}/`);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /LEVANI ART/);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${base}/${l}/`);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveCount(1);
    const emblem = page.locator('.lang__trigger img.emblem');
    await expect(emblem).toHaveAttribute('src', `/emblems/${EMBLEM[l]}.webp`);
    await scrollThrough(page);
    await expect.poll(() => brokenImages(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await expectMessengers(page.locator('footer'));
    await expect(page.locator(`footer a[href="${IG}"]`)).toHaveCount(1);
    expect(hits).toEqual([]);
  });

  test(`${l}: language selector — arms only, caret, 6 languages, switching works`, async ({ page }) => {
    await page.goto(`/${l}/collection/`);
    const trigger = page.locator('.lang__trigger');
    await expect(page.locator('header select')).toHaveCount(0);
    await expect(trigger.locator('.lang__caret svg')).toHaveCount(1);
    if (isDesktop(page)) {
      expect(await trigger.locator('.lang__name').evaluate((e) => e.getBoundingClientRect().width)).toBe(0);
      await trigger.hover();
      await expect
        .poll(() => trigger.locator('.lang__name').evaluate((e) => e.getBoundingClientRect().width))
        .toBeGreaterThan(20);
      await trigger.click();
    } else {
      await trigger.tap();
    }
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    for (const o of LOCALES) {
      const item = page.getByRole('menuitemradio', { name: NAMES[o] });
      const img = item.locator('img.emblem');
      await expect(img).toHaveAttribute('src', `/emblems/${EMBLEM[o]}.webp`);
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    }
    if (!isDesktop(page)) {
      const box = await menu.boundingBox();
      expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(830); // bottom sheet
    }
    const target = l === 'en' ? 'fr' : 'en';
    await page.getByRole('menuitemradio', { name: NAMES[target] }).click();
    await expect(page).toHaveURL(new RegExp(`/${target}/collection/?$`));
    await expect(page.locator('html')).toHaveAttribute('lang', target);
  });

  test(`${l}: collection — 18 works, all images load`, async ({ page }) => {
    const hits = watchOptimizer(page);
    await page.goto(`/${l}/collection/`);
    await expect(page.locator('.gallery > li')).toHaveCount(18);
    await scrollThrough(page);
    await expect.poll(() => brokenImages(page)).toEqual([]);
    expect(hits).toEqual([]);
  });

  test(`${l}: all 18 artwork pages open directly, survive refresh, no prices`, async ({ page }) => {
    const hits = watchOptimizer(page);
    for (const a of source) {
      const res = await page.goto(`/${l}/artworks/${a.slug}/`);
      expect(res?.status(), a.slug).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(a.title);
      // Name the work and the file if its photograph fails to load.
      const photo = page.locator('.artwork__frame img');
      await expect
        .poll(
          () => photo.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : -1)),
          { message: `${l}/${a.slug}: photo ${await photo.evaluate((i: HTMLImageElement) => i.currentSrc || i.src)}` },
        )
        .toBeGreaterThan(0);
      // WhatsApp opens with a message naming this very work.
      await expectMessengers(page.locator('.artwork__contact'), a.title);
      await expect(page.locator(`.artwork__contact a[href="${IG}"]`)).toHaveCount(1);
      await expect(page.getByText(PRICE_ON_REQUEST[l]!, { exact: true })).toBeVisible();
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/artworks\//);
      const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
      expect(JSON.parse(ld!)).not.toHaveProperty('offers');
      expect((await page.locator('main').innerText())).not.toMatch(PRICE);
    }
    // Refresh of an inner page must not 404.
    const reload = await page.reload();
    expect(reload?.status()).toBe(200);
    expect(hits).toEqual([]);
  });
}

test('every sitemap URL is live; no broken internal links', async ({ request, page }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
  expect(urls.length).toBe(168);
  expect((await request.get('/robots.txt')).status()).toBe(200);
  const links = new Set<string>();
  for (const path of urls) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const html = await res.text();
    expect(html, `${path}: form/service copy`).not.toMatch(NO_FORM_OR_SERVICE);
    expect(html, `${path}: <form>`).not.toContain('<form');
    for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) links.add(m[1]!);
    for (const m of html.matchAll(/src="(\/[^"?]*)/g)) links.add(m[1]!);
  }
  const broken: string[] = [];
  for (const href of links) {
    if (href.startsWith('/_next/static/')) continue; // hashed assets, checked by page loads
    const res = await request.get(href, { maxRedirects: 3 });
    if (res.status() !== 200) broken.push(`${res.status()} ${href}`);
  }
  expect(broken).toEqual([]);
  // A locale page opened without the trailing slash still lands.
  const r = await page.goto('/ru/about');
  expect(r?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});

test('unknown URL → branded 404 in the path language', async ({ page }) => {
  const res = await page.goto('/de/gibt-es-nicht/');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('nicht in der Sammlung');
});

test('enquire page: messengers + Instagram, no form', async ({ page }) => {
  await page.goto('/hy/enquire/?artwork=aknuni');
  await expect(page.locator('form')).toHaveCount(0);
  await expectMessengers(page.locator('.enquiry-contact'));
  await expect(page.locator(`.enquiry-contact a[href="${IG}"]`)).toHaveCount(1);
  await expect(page.getByText('Aknuni / Ակնունի').first()).toBeVisible();
});
