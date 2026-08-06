/**
 * Screenshots the admin panel and partner dashboard by actually driving
 * them: real sign-in against the running API, real navigation, real data.
 * Nothing is stubbed.
 *
 * Usage: node tools/preview/shoot-web.mjs '<credsJson>'
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const OUT = join(process.cwd(), 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

const creds = JSON.parse(process.argv[2] ?? '{}');
const VIEWPORT = { width: 1440, height: 900 };

async function signIn(page, baseUrl, phone, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const inputs = page.locator('input');
  await inputs.nth(0).fill(phone);
  await inputs.nth(1).fill(password);
}

async function shoot(page, name, { full = true } = {}) {
  await page.waitForTimeout(1100); // let react-query settle + transitions finish
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
  console.log(`  ✓ ${name}.png`);
}

async function run() {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });

  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.error('  browser error:', m.text()));

  // ── Admin ───────────────────────────────────────────────────────────
  console.log('Admin panel:');
  await signIn(page, 'http://localhost:3000', creds.admin.phone, creds.admin.password);
  await shoot(page, 'admin-login', { full: false });

  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('http://localhost:3000/', { timeout: 20000 });
  await shoot(page, 'admin-overview');

  // Navigate by clicking the sidebar rather than page.goto(): a hard load
  // remounts AuthGate before zustand has rehydrated from localStorage, which
  // bounces to /login. Client-side routing keeps the session in memory.
  for (const [link, name] of [
    ['Users', 'admin-users'],
    ['Partners', 'admin-partners'],
    ['Bonus adjustments', 'admin-bonus-adjustment'],
    ['Fraud signals', 'admin-fraud-signals'],
    ['Audit log', 'admin-audit-log'],
  ]) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await page.waitForTimeout(900);
    await shoot(page, name);
  }

  // ── Partner ─────────────────────────────────────────────────────────
  console.log('Partner dashboard:');
  const ctx2 = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const p2 = await ctx2.newPage();

  await signIn(p2, 'http://localhost:3001', creds.partner.phone, creds.partner.password);
  await shoot(p2, 'partner-login', { full: false });

  await p2.getByRole('button', { name: 'Sign in' }).click();
  await p2.waitForURL('http://localhost:3001/', { timeout: 20000 });
  await shoot(p2, 'partner-overview');

  await p2.getByRole('link', { name: 'Transactions', exact: true }).click();
  await p2.waitForTimeout(900);
  await shoot(p2, 'partner-transactions');

  // Generate a live invoice so the QR screen shows its active state.
  await p2.getByRole('link', { name: 'Payment QR', exact: true }).click();
  await p2.waitForTimeout(700);
  await shoot(p2, 'partner-qr-empty');
  await p2.locator('input').first().fill('8500');
  const generate = p2.locator('form button[type="submit"]').first();
  if (await generate.isEnabled()) {
    await generate.click();
    await p2.waitForTimeout(1800);
  } else {
    console.warn('  ! Generate QR disabled — capturing the empty state instead');
  }
  await shoot(p2, 'partner-qr-active');

  await p2.getByRole('link', { name: 'EV stations', exact: true }).click();
  await p2.waitForTimeout(900);
  await shoot(p2, 'partner-ev-stations');

  await browser.close();
  console.log('\nDone.');
}

run().catch((e) => {
  console.error('SHOOT FAILED:', e);
  process.exit(1);
});
