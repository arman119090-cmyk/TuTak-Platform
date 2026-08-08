/**
 * Screenshots every dashboard page against a live local stack.
 *
 * Logs in through the real login form rather than injecting a token, so the
 * captures show what an operator actually sees — including anything that
 * only renders once a session exists.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.resolve(__dirname, '../../docs/screenshots');
const VIEWPORT = { width: 1440, height: 900 };

const ADMIN = process.env.ADMIN_URL || 'http://localhost:3000';
const PARTNER = process.env.PARTNER_URL || 'http://localhost:3001';

const ADMIN_PAGES = [
  ['admin-overview', '/'],
  ['admin-users', '/users'],
  ['admin-partners', '/partners'],
  ['admin-bonus-adjustment', '/bonus'],
  ['admin-refunds', '/refunds'],
  ['admin-payouts', '/payouts'],
  ['admin-ledger', '/ledger'],
  ['admin-reconciliation', '/reconciliation'],
  ['admin-fraud-signals', '/fraud-signals'],
  ['admin-audit-log', '/audit-logs'],
];

const PARTNER_PAGES = [
  ['partner-overview', '/'],
  ['partner-transactions', '/transactions'],
  ['partner-qr', '/qr'],
  ['partner-earnings', '/earnings'],
  ['partner-ev-stations', '/ev-stations'],
];

async function login(page, baseUrl, phone, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  // The web forms take the full number; only the mobile app splits off a
  // +374 prefix into its own affix.
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(phone);
  await inputs.nth(1).fill(password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 });
}

async function capture(page, baseUrl, pages, label) {
  for (const [name, route] of pages) {
    try {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
      // Data arrives via react-query after hydration; a fixed settle beats
      // guessing a selector that differs per page.
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message.split('\n')[0]}`);
    }
  }
  void label;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });

  const phone = process.env.SEED_ADMIN_PHONE || '+37400000000';
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    console.error('SEED_ADMIN_PASSWORD must be set to log in.');
    process.exit(1);
  }

  // Login screens first, while logged out.
  const anon = await browser.newPage({ viewport: VIEWPORT });
  for (const [name, url] of [
    ['admin-login', `${ADMIN}/login`],
    ['partner-login', `${PARTNER}/login`],
  ]) {
    try {
      await anon.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await anon.waitForTimeout(600);
      await anon.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message.split('\n')[0]}`);
    }
  }
  await anon.close();

  console.log('Admin:');
  const adminPage = await browser.newPage({ viewport: VIEWPORT });
  try {
    await login(adminPage, ADMIN, phone, password);
    await capture(adminPage, ADMIN, ADMIN_PAGES, 'admin');
  } catch (err) {
    console.log(`  ✗ admin login: ${err.message.split('\n')[0]}`);
  }
  await adminPage.close();

  console.log('Partner:');
  const partnerPage = await browser.newPage({ viewport: VIEWPORT });
  try {
    // Not the super admin. The partner dashboard resolves "my partner" from
    // a partner-scoped role, and a global admin has none — it lands on a
    // login that never redirects, or on screens full of zeros. The demo
    // seeder creates this account scoped to the partner the money runs
    // through.
    const partnerPhone = process.env.SEED_PARTNER_PHONE || '+37477200001';
    await login(partnerPage, PARTNER, partnerPhone, password);
    await capture(partnerPage, PARTNER, PARTNER_PAGES, 'partner');
  } catch (err) {
    console.log(`  ✗ partner login: ${err.message.split('\n')[0]}`);
  }
  await partnerPage.close();

  await browser.close();
})();
