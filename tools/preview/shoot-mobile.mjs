/**
 * Screenshots every mobile screen from the react-native-web harness at
 * iPhone 14 dimensions (390×844 @2x). Signs in against the running API
 * first, so each screen renders live data from the real backend.
 *
 * Usage: node tools/preview/shoot-mobile.mjs '<credsJson>'
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join, extname } from 'path';

const OUT = join(process.cwd(), 'docs', 'screenshots');
const DIR = join(process.cwd(), 'tools', 'preview', 'mobile');
const PORT = 3002;
const API = 'http://127.0.0.1:4000/v1';
mkdirSync(OUT, { recursive: true });

const creds = JSON.parse(process.argv[2] ?? '{}');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      const file = path === '/' ? '/index.html' : path;
      try {
        const body = await readFile(join(DIR, file));
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

/** Screens that need an authenticated session vs. the ones that don't. */
const SCREENS = [
  ['splash', 'mobile-01-splash', false],
  ['login', 'mobile-02-login', false],
  ['register', 'mobile-03-register', false],
  ['home', 'mobile-04-home', true],
  ['wallet', 'mobile-05-wallet', true],
  ['my-qr', 'mobile-06-my-qr', true],
  ['scan-qr', 'mobile-07-scan-qr', true],
  ['ev-stations', 'mobile-08-ev-stations', true],
  ['ev-history', 'mobile-09-ev-history', true],
  ['referral', 'mobile-10-referral', true],
  ['transactions', 'mobile-11-transactions', true],
  ['notifications', 'mobile-12-notifications', true],
  ['settings', 'mobile-13-settings', true],
];

async function run() {
  const server = await serve();
  console.log(`harness on :${PORT}`);

  // Real sign-in — the harness renders whatever this account actually has.
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: creds.customer.phone,
      password: creds.customer.password,
      deviceId: 'preview',
    }),
  });
  const { data } = await res.json();
  const session = encodeURIComponent(
    JSON.stringify({
      user: data.user,
      accessToken: data.tokens.accessToken,
      refreshToken: data.tokens.refreshToken,
    }),
  );
  console.log(`signed in as ${data.user.firstName} ${data.user.lastName}`);

  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  for (const [screen, name, needsAuth] of SCREENS) {
    const url = `http://localhost:${PORT}/?screen=${screen}${needsAuth ? `&session=${session}` : ''}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600); // react-query + entry animations
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`  ✓ ${name}.png`);
  }

  if (errors.length) {
    console.error('\npage errors:');
    [...new Set(errors)].slice(0, 8).forEach((e) => console.error('  -', e));
  }

  await browser.close();
  server.close();
  console.log('\nDone.');
}

run().catch((e) => {
  console.error('SHOOT FAILED:', e);
  process.exit(1);
});
