/**
 * Screenshots the two media management surfaces against the live stack,
 * signing in through the real login form the same way capture-dashboards.js
 * does.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.resolve('/home/user/TuTak-Platform/docs/screenshots/media');
const VIEWPORT = { width: 1440, height: 1000 };
const creds = JSON.parse(process.argv[2]);

async function login(page, baseUrl, phone, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(phone);
  await inputs.nth(1).fill(password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  // ── Partner: the branding page, as the owner of the partner that has a
  //    live logo and a cover awaiting review.
  const partnerCtx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const partnerPage = await partnerCtx.newPage();
  partnerPage.on('pageerror', (e) => console.log('  partner pageerror:', e.message));
  await login(partnerPage, 'http://localhost:3001', creds.brandingOwnerPhone, 'Passw0rd!23');
  await partnerPage.goto('http://localhost:3001/branding', { waitUntil: 'networkidle' });
  await partnerPage.waitForTimeout(2500);
  await partnerPage.screenshot({ path: path.join(OUT, '14-partner-branding.png'), fullPage: true });
  console.log('  ✓ 14-partner-branding.png');
  await partnerCtx.close();

  // ── Admin: the approval queue.
  const adminCtx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const adminPage = await adminCtx.newPage();
  adminPage.on('pageerror', (e) => console.log('  admin pageerror:', e.message));
  await login(adminPage, 'http://localhost:3000', creds.admin.phone, creds.admin.password);
  await adminPage.goto('http://localhost:3000/media', { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(2500);
  await adminPage.screenshot({ path: path.join(OUT, '15-admin-media-queue.png'), fullPage: true });
  console.log('  ✓ 15-admin-media-queue.png');
  await adminCtx.close();

  await browser.close();
  console.log(`\nDone — ${OUT}`);
})().catch((e) => {
  console.error('DASHBOARD SHOOT FAILED:', e);
  process.exit(1);
});
