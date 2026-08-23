/**
 * Screenshots the media system's customer-facing surfaces against a live API.
 *
 * A separate entry point from `shoot-mobile.mjs`, which photographs the whole
 * app at a fixed screen list. This one is narrower and needs things that one
 * does not: route params (the partner detail card, a specific purchase
 * intent), and two different accounts photographed in sequence to show the
 * Level-1 consent rule from the referrer's side with and without consent.
 *
 * Every screen here is the real, unmodified component from `apps/mobile`,
 * rendered through react-native-web against the running backend. Nothing is
 * staged in the harness: the logos are files a partner actually uploaded, and
 * the brand on a history row is the snapshot that row actually carries.
 *
 * Usage: node tools/preview/shoot-media.mjs '<credsJson>'
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join, extname } from 'path';

const OUT = join(process.cwd(), 'docs', 'screenshots', 'media');
const DIR = join(process.cwd(), 'tools', 'preview', 'mobile');
// 3002 deliberately: it is the port the API's dev CORS allowlist already
// carries (see CORS_ORIGINS), and the harness is a browser making
// cross-origin XHRs to the API like any other client. On 3003 every request
// is blocked and every screen photographs as its error state — which looks
// exactly like a broken feature.
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

  const customer = await signIn(creds.customer.phone, creds.customer.password, 'shot-media');
  console.log(`signed in as ${customer.user.firstName} ${customer.user.lastName}`);
  const token = customer.tokens.accessToken;
  const session = sessionParam(customer);

  // Real records, read the same way the app reads them, so the screenshots
  // cannot drift from what the API actually returns.
  const nearby = await api('/partners/nearby?lat=40.183&lng=44.512&radiusKm=10', token);
  const branch = nearby.find((b) => b.logo) ?? nearby[0];
  if (!branch) throw new Error('no nearby branch to photograph');
  console.log(`partner card: ${branch.name}, logo=${branch.logo ? 'yes' : 'NO'}`);

  const intent = creds.liveIntentId
    ? await api(`/purchase-intents/${creds.liveIntentId}`, token)
    : null;

  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });

  const errors = [];

  /**
   * One shot. `width` defaults to an iPhone 14; the spec's §6 also asks for a
   * 360dp Android width, which the fallback shots below use.
   */
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
    const url =
      `http://localhost:${PORT}/?${query.toString()}`.replace('__SESSION__', sess ?? '');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    if (scroll) {
      // react-native-web renders a ScrollView as an overflow container, not
      // as the document, so `fullPage` and window scrolling both miss it. The
      // tallest scrollable element is the screen's own list.
      // The callback below is serialised and executed inside the page, where
      // `document` exists. This file is linted under the Node config, which
      // deliberately has no browser globals — adding them would stop
      // catching a real stray `document` in the Node half of the script — so
      // the one genuinely-in-page reference is exempted by hand.
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

  // ── Partner logo on the customer's surfaces ──────────────────────────────
  // Scrolled past the EV stations, which sit nearest to the seeded point, to
  // the partner cards this shot is about.
  await shoot('01-partners-map-logos', { screen: 'partners', session, scroll: 1800 });
  await shoot('02-partner-detail-logo', { screen: 'partner-detail', params: { partner: branch }, session });
  await shoot('03-home-recent-operations', { screen: 'home', session });
  await shoot('04-transaction-history', { screen: 'transactions', session });
  await shoot('05-wallet-source-rows', { screen: 'wallet', session });
  await shoot('06-purchase-preview', {
    screen: 'create-purchase-intent',
    params: { partnerId: branch.partnerId, partnerName: branch.name },
    session,
  });
  if (intent) {
    await shoot('07-purchase-awaiting', {
      screen: 'purchase-intent-status',
      params: { intent },
      session,
    });
  }

  // ── The customer's own avatar, and the Profile control ───────────────────
  await shoot('08-profile-avatar', { screen: 'settings', session });

  // ── The consent rule, from the referrer's side, both ways ────────────────
  // Scrolled to the Level-1 list, which is what these two shots are about.
  await shoot('09-referral-l1-consent-on', { screen: 'referral', session, scroll: 1150 });

  // Turn the consenting friend's consent off, re-shoot, turn it back on. The
  // same referrer, the same list, one flag apart — which is the only way to
  // show that the branch is real rather than that nobody had a photo.
  const before = await api('/referral/me/invites', token);
  const consented = before.filter((i) => i.referee?.avatar).length;
  console.log(`  L1 rows with an avatar, consent on: ${consented}`);

  const friend = await signIn(creds.consentedFriendPhone, 'Passw0rd!23', 'shot-media-friend');
  await fetch(`${API}/users/me/avatar-consent`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${friend.tokens.accessToken}`,
    },
    body: JSON.stringify({ showAvatarInReferralList: false }),
  });

  const after = await api('/referral/me/invites', token);
  const stillShown = after.filter((i) => i.referee?.avatar).length;
  console.log(`  L1 rows with an avatar, consent off: ${stillShown}`);
  await shoot('10-referral-l1-consent-off', { screen: 'referral', session, scroll: 1150 });

  await fetch(`${API}/users/me/avatar-consent`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${friend.tokens.accessToken}`,
    },
    body: JSON.stringify({ showAvatarInReferralList: true }),
  });

  // ── The fallback, at both widths the spec's §6 names ─────────────────────
  // A partner with no logo and an account with no avatar must show the
  // neutral mark, never a gap and never a broken image.
  const plain = creds.noMediaCustomer
    ? await signIn(creds.noMediaCustomer.phone, creds.noMediaCustomer.password, 'shot-media-plain')
    : null;
  if (plain) {
    const plainSession = sessionParam(plain);
    await shoot('11-fallback-390pt-iphone', { screen: 'settings', session: plainSession, width: 390 });
    await shoot('12-fallback-360dp-android', {
      screen: 'settings',
      session: plainSession,
      width: 360,
      height: 800,
    });
    await shoot('13-fallback-partners-360dp', {
      screen: 'partners',
      session: plainSession,
      width: 360,
      height: 800,
      scroll: 1800,
    });
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
