/**
 * Screenshots the Map/Explore redesign (2026-08-23) against a live API.
 *
 * Same harness pattern as `shoot-media.mjs`: real, unmodified screen
 * components rendered through react-native-web against the running backend,
 * nothing staged. Narrower in scope — this one is about the map screen, its
 * pins, and the partner detail screen's new cover-photo block.
 *
 * Usage: node tools/preview/shoot-map-redesign.mjs '<credsJson>'
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join, extname } from 'path';

const OUT = join(process.cwd(), 'docs', 'screenshots', 'map-redesign');
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

async function signIn(phone, password, deviceId) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password, deviceId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`sign-in ${phone}: ${JSON.stringify(json).slice(0, 300)}`);
  return json.data;
}

async function api(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json).slice(0, 300)}`);
  return json.data;
}

function sessionParam(auth) {
  return encodeURIComponent(
    JSON.stringify({
      user: auth.user,
      accessToken: auth.tokens.accessToken,
      refreshToken: auth.tokens.refreshToken,
    }),
  );
}

async function run() {
  const server = await serve();
  console.log(`harness on :${PORT}`);

  const customer = await signIn(creds.customer.phone, creds.customer.password, 'shot-map-redesign');
  console.log(`signed in as ${customer.user.firstName} ${customer.user.lastName}`);
  const token = customer.tokens.accessToken;
  const session = sessionParam(customer);

  const nearby = await api('/partners/nearby?lat=40.183&lng=44.512&radiusKm=10', token);
  const withLogo = nearby.find((b) => b.logo);
  const withCover = nearby.find((b) => b.cover);
  const branch = withLogo ?? nearby[0];
  console.log(`${nearby.length} nearby rows, ${nearby.filter((b) => b.logo).length} with a logo, ${nearby.filter((b) => b.cover).length} with an ACTIVE cover`);
  if (!branch) throw new Error('no nearby branch to photograph');

  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });

  const errors = [];

  async function shoot(name, { screen, params, session: sess, width = 390, height = 844, scroll = 0 }) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    const query = new URLSearchParams({ screen, theme: 'light' });
    if (params) query.set('params', JSON.stringify(params));
    if (sess) query.set('session', '__SESSION__');
    const url = `http://localhost:${PORT}/?${query.toString()}`.replace('__SESSION__', sess ?? '');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    if (scroll) {
      /* eslint-disable no-undef */
      await page.evaluate((y) => {
        const scrollables = [...document.querySelectorAll('div')].filter(
          (el) => el.scrollHeight > el.clientHeight + 40,
        );
        const target = scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (target) target.scrollTop = y;
      }, scroll);
      /* eslint-enable no-undef */
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    await ctx.close();
    console.log(`  ✓ ${name}.png`);
  }

  // ── The map itself: pins, chips, search, "Рядом с вами" list ────────────
  await shoot('01-map-top', { screen: 'partners', session, width: 390 });
  await shoot('02-map-list-scrolled', { screen: 'partners', session, width: 390, scroll: 700 });
  await shoot('03-map-360dp-android', { screen: 'partners', session, width: 360, height: 800 });

  // ── Partner detail: the new cover-photo block (or its honest fallback) ──
  await shoot('04-partner-detail', {
    screen: 'partner-detail',
    params: { partner: branch },
    session,
  });
  if (withCover) {
    await shoot('05-partner-detail-with-cover', {
      screen: 'partner-detail',
      params: { partner: withCover },
      session,
    });
  } else {
    console.log('  (no partner in this dataset has an ACTIVE cover — see completion report)');
  }

  await browser.close();
  server.close();

  if (errors.length) {
    console.error('\npage errors:');
    [...new Set(errors)].slice(0, 10).forEach((e) => console.error('  -', e));
  }
  console.log(`\nDone — ${OUT}`);
}

run().catch((e) => {
  console.error('SHOOT FAILED:', e);
  process.exit(1);
});
