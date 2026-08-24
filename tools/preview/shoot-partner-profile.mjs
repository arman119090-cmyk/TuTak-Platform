/**
 * Screenshots the partner public profile (about text + offerings list) and
 * the map pin's own-logo rendering, against a live API — confirmed with
 * Arman 2026-08-23.
 *
 * Same harness pattern as `shoot-map-redesign.mjs`: real, unmodified screen
 * components rendered through react-native-web against the running backend.
 * Unlike that script, this one also *sets up* its own data over the real
 * HTTP API before shooting anything, rather than taking prepared creds as an
 * argument: a fresh customer account (OTP flow, code read from the API
 * process's own stdout log — same technique as today's pentest/hardening
 * work), granted PARTNER_OWNER of an already-ACTIVE, already-logo'd seeded
 * partner (Jazzve) by the seeded admin account, so the map pin's logo is a
 * real, previously-approved asset and only the about/offerings write is new.
 *
 * Usage: node tools/preview/shoot-partner-profile.mjs [path-to-api-log]
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const OUT = join(process.cwd(), 'docs', 'screenshots', 'partner-profile');
const DIR = join(process.cwd(), 'tools', 'preview', 'mobile');
const PORT = 3002;
const API = 'http://127.0.0.1:4000/v1';
const LOG_FILE = process.argv[2] ?? '/tmp/api-server.log';
const JAZZVE_ID = '05039401-26ca-46f8-ae50-e080fd91be78';
const ADMIN_PHONE = '+37400000001';

mkdirSync(OUT, { recursive: true });
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

async function post(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`POST ${path}: ${JSON.stringify(json).slice(0, 500)}`);
  return json.data;
}

async function patch(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`PATCH ${path}: ${JSON.stringify(json).slice(0, 500)}`);
  return json.data;
}

async function put(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`PUT ${path}: ${JSON.stringify(json).slice(0, 500)}`);
  return json.data;
}

async function get(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`GET ${path}: ${JSON.stringify(json).slice(0, 500)}`);
  return json.data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the most recent 6-digit OTP the console SMS provider logged for
 * `phone`, from the API process's own stdout. Real OTP flow, not a guessed
 * or seeded password — same technique as `docs/PENTEST_2026-08-23.md`.
 *
 * Polled rather than read once: the API writes to `LOG_FILE` through a
 * redirected, block-buffered stdout, so the line this just triggered is not
 * always visible to a `grep` that runs immediately after the request
 * resolves.
 */
async function latestOtpFor(phone) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const raw = execSync(`grep -F "to=${phone} " "${LOG_FILE}" | tail -n 1`, { encoding: 'utf8' });
      const match = raw.match(/code is (\d{6})/);
      if (match) return match[1];
    } catch {
      // grep exits non-zero when nothing matches yet — keep polling.
    }
    await sleep(300);
  }
  throw new Error(`no OTP found in log for ${phone} after polling`);
}

function randomPhone() {
  const digits = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
  return `+374${digits}`;
}

async function run() {
  const server = await serve();
  console.log(`harness on :${PORT}`);

  // ── 1. Fresh customer, real OTP flow ────────────────────────────────────
  const phone = randomPhone();
  const deviceId = 'shot-partner-profile';
  await post('/auth/register/request-otp', { phone });
  const otp = await latestOtpFor(phone);
  const customer = await post('/auth/register/verify-otp', {
    phone,
    code: otp,
    firstName: 'Profile',
    lastName: 'Preview',
    deviceId,
  });
  console.log(`registered ${phone} as ${customer.user.id}`);

  // ── 2. Admin, real OTP flow, using the seeded admin account ─────────────
  await post('/auth/login/request-otp', { phone: ADMIN_PHONE });
  const adminOtp = await latestOtpFor(ADMIN_PHONE);
  const admin = await post('/auth/login/verify-otp', {
    phone: ADMIN_PHONE,
    code: adminOtp,
    deviceId: 'shot-partner-profile-admin',
  });
  const adminToken = admin.tokens.accessToken;
  console.log(`admin session as ${admin.user.firstName} ${admin.user.lastName}`);

  // ── 3. Admin grants this fresh customer PARTNER_OWNER of Jazzve ─────────
  // Jazzve is a seeded partner that already has an ACTIVE (approved) logo
  // and a real branch — reusing it means the map pin's logo in these shots
  // is a genuinely approved asset, and only the about/offerings write below
  // is new.
  await post('/admin/users/roles', { userId: customer.user.id, role: 'PARTNER_OWNER', partnerId: JAZZVE_ID }, adminToken);
  console.log(`granted PARTNER_OWNER of Jazzve (${JAZZVE_ID})`);

  // JWT claims (partnerScopes) are baked in at issuance — the role grant
  // above needs a fresh token to actually carry it.
  await post('/auth/login/request-otp', { phone });
  const reloginOtp = await latestOtpFor(phone);
  const owner = await post('/auth/login/verify-otp', { phone, code: reloginOtp, deviceId });
  const ownerToken = owner.tokens.accessToken;

  // ── 4. As owner: write the public profile — live immediately, no review ─
  await patch(
    `/partners/${JAZZVE_ID}/about`,
    {
      about:
        'Specialty coffee roasted in-house since 2014. Northern Avenue is our flagship — come say hi.',
    },
    ownerToken,
  );
  await put(
    `/partners/${JAZZVE_ID}/offerings`,
    {
      offerings: [
        { name: 'Espresso', description: 'Double shot, our own blend', price: '1200' },
        { name: 'Flat White', description: 'Oat or cow milk', price: '1800' },
        { name: 'House filter coffee', description: null, price: '1500' },
      ],
    },
    ownerToken,
  );
  console.log('about + offerings saved');

  // ── 5. Fetch what the customer app actually sees ────────────────────────
  const nearby = await get('/partners/nearby?lat=40.183&lng=44.512&radiusKm=10', ownerToken);
  const branch = nearby.find((b) => b.partnerId === JAZZVE_ID);
  if (!branch) throw new Error('Jazzve branch not in nearby results — check seed data / radius');
  console.log(`branch: ${branch.name} — ${branch.branchName}, logo=${!!branch.logo}`);

  const detail = await get(`/partners/${JAZZVE_ID}`, ownerToken);
  console.log(`detail about="${detail.about}" offerings=${detail.offerings.length}`);

  // ── 6. Shoot ──────────────────────────────────────────────────────────
  const sessionParam = (auth) =>
    encodeURIComponent(
      JSON.stringify({
        user: auth.user,
        accessToken: auth.tokens.accessToken,
        refreshToken: auth.tokens.refreshToken,
      }),
    );
  const session = sessionParam(owner);

  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });
  const errors = [];

  async function shoot(name, { screen, params, width = 390, height = 844, scroll = 0 }) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    const query = new URLSearchParams({ screen, theme: 'light', session });
    if (params) query.set('params', JSON.stringify(params));
    await page.goto(`http://localhost:${PORT}/?${query.toString()}`, { waitUntil: 'networkidle' });
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

  // The map: the pin now shows Jazzve's real logo instead of the cafe icon.
  await shoot('01-map-with-logo-pin', { screen: 'partners' });

  // The detail screen: mini-map pin, about text, offerings list.
  await shoot('02-partner-detail-profile', { screen: 'partner-detail', params: { partner: branch } });
  await shoot('03-partner-detail-profile-scrolled', {
    screen: 'partner-detail',
    params: { partner: branch },
    scroll: 500,
  });

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
