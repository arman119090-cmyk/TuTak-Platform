// Браузерная проверка собранного сайта: шрифты, скриншоты, форма, переключатель языка.
// Запуск: собрать и поднять сервер (LEAD_DRY_RUN=1 npm run build && npm start), затем
//   BASE=http://127.0.0.1:4321 OUT=./shots node tests/browser-check.mjs
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4321';
const OUT = process.env.OUT ?? './shots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

// 1. Шрифты: какие реально отрисованы (через CDP, а не computed style).
for (const lang of ['hy', 'ru', 'en']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/${lang}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const fontsOf = async (sel) => {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map((f) => `${f.familyName}(${f.glyphCount})`).join(', ');
  };
  const h1 = await fontsOf('h1');
  const p = await fontsOf('.hero-lead');
  const h2 = await fontsOf('#directions-title');
  console.log(`     ${lang}: h1=[${h1}] lead=[${p}] h2=[${h2}]`);
  if (lang === 'hy') {
    check(/^Noto Serif Armenian/.test(h1) && !/DejaVu|Free|Liberation/.test(h1), 'hy h1 — Noto Serif Armenian, без системного');
    check(/^Noto Sans Armenian/.test(p) && !/DejaVu|Free|Liberation/.test(p), 'hy текст — Noto Sans Armenian, без системного');
  } else {
    check(/^Cormorant Garamond/.test(h1), `${lang} h1 — Cormorant Garamond`);
    check(/^Onest/.test(p), `${lang} текст — Onest`);
  }
  // Армянские символы в реквизитах на RU/EN-странице не должны уходить в системный шрифт.
  const req = await fontsOf('#about dd');
  check(!/DejaVu|Free|Liberation/.test(req), `${lang} реквизиты без системных шрифтов [${req}]`);
  await page.close();
}

// 2. Скриншоты и горизонтальный скролл.
for (const width of [390, 768, 1280, 1440]) {
  for (const lang of ['hy', 'ru', 'en']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(`${BASE}/${lang}/`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `${lang} @${width}: нет горизонтального скролла (${overflow}px)`);
    // Прокрутка до конца, чтобы подгрузились lazy-картинки ниже первого экрана.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle');
    const broken = await page.evaluate(() =>
      Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.currentSrc || i.src),
    );
    check(broken.length === 0, `${lang} @${width}: все картинки загружены ${broken.join(' ')}`);
    await page.screenshot({ path: `${OUT}/${lang}-${width}.png`, fullPage: true });
    await page.close();
  }
}

// 3. Переключатель языка сохраняет раздел.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/ru/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('#about').scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(300);
  await page.click('.lang--desktop a[lang="en"]');
  await page.waitForLoadState('networkidle');
  check(page.url().endsWith('/en/#about'), `переключатель RU→EN из «О компании» → ${page.url()}`);
  await page.close();
}

// 4. Мобильное меню: бургер открывает, Escape закрывает.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/hy/`, { waitUntil: 'networkidle' });
  await page.click('[data-burger]');
  check(await page.isVisible('.nav-list'), 'бургер открывает меню');
  await page.waitForTimeout(400); // анимация крестика
  await page.screenshot({ path: `${OUT}/hy-390-menu.png` });
  await page.keyboard.press('Escape');
  check(!(await page.isVisible('.nav-list')), 'Escape закрывает меню');
  check((await page.getAttribute('.header-call', 'aria-label'))?.length > 0, 'у иконки звонка есть aria-label');
  await page.close();
}

// 5. Форма: без согласия не уходит; с согласием — успех на языке страницы.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let posted = 0;
  page.on('request', (r) => r.url().endsWith('/api/lead') && posted++);
  await page.goto(`${BASE}/en/#contact`, { waitUntil: 'networkidle' });
  await page.fill('#lead-name', 'Test Person');
  await page.fill('#lead-phone', '043 357 007');
  await page.selectOption('#lead-type', 'renovation');
  await page.click('[data-submit]');
  await page.waitForTimeout(300);
  check(posted === 0, 'без чекбокса согласия запрос не отправлен');
  check((await page.textContent('[data-status]')).includes('consent'), 'сообщение про согласие по-английски');
  await page.check('#lead-consent');
  await page.click('[data-submit]');
  await page.waitForFunction(() => document.querySelector('[data-status]').dataset.kind === 'ok', null, { timeout: 5000 }).catch(() => {});
  const txt = await page.textContent('[data-status]');
  check(posted === 1 && txt.startsWith('Thank you'), `заявка отправлена, ответ: «${txt}»`);
  check(page.url().endsWith('/en/#contact'), 'без перезагрузки страницы');
  await page.screenshot({ path: `${OUT}/en-form-ok.png`, clip: { x: 0, y: 0, width: 1280, height: 900 } });
  await page.close();
}

// 6. Клавиатура: первый Tab — ссылка «Перейти к содержанию».
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/ru/`, { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  check((await page.evaluate(() => document.activeElement.className)) === 'skip-link', 'Tab → skip-link');
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} проверок провалено` : '\nвсе проверки прошли');
process.exit(failures ? 1 : 0);
