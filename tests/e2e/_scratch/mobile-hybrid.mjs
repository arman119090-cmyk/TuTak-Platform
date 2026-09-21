import { chromium } from '@playwright/test';
const [,, port = '8098', out = 'docs/screenshots/hybrid', locale = 'en', width = '390', tag = ''] = process.argv;
const base = `http://localhost:${port}`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
const P = 'partner-1';
const user = { id: 'user-1', phone: '+37491000001', email: null, firstName: 'Ani', lastName: 'Customer', roles: ['CUSTOMER'], partnerScopes: {}, locale, isPhoneVerified: true, avatar: null, showAvatarInReferralList: false, personalizedRecommendationsEnabled: false, mustChangePassword: false };
const tokens = { accessToken: 'stub-access', refreshToken: 'stub-refresh', accessTokenExpiresAt: new Date(Date.now()+3600e3).toISOString(), refreshTokenExpiresAt: new Date(Date.now()+86400e3).toISOString() };
const wallet = { id: 'w-1', userId: 'user-1', availableBonus: '5000.0000', pendingBonus: '0.0000', reservedBonus: '0.0000', lifetimeEarned: '9000.0000', lifetimeSpent: '4000.0000', currency: 'BONUS_POINT' };
const brand = { partnerId: P, displayName: 'Coffee Corner', logo: null };
const nearby = { id: 'branch-1', partnerId: P, name: 'Coffee Corner', branchName: 'Northern Avenue', category: 'cafe', address: 'Northern Ave 1', city: 'Yerevan', latitude: 40.1811, longitude: 44.5136, cashbackPercent: 5, distanceKm: 0.3, isHighCashback: false, logo: null, cover: null };
const detail = { id: P, displayName: 'Coffee Corner', category: 'cafe', bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50, isActive: true, logo: null, cover: null, createdAt: '2026-01-01T00:00:00.000Z', description: null, products: [] };
const balance = { available: '50000.0000', reserved: '0.0000', book: '50000.0000', balance: '50000.0000', currency: 'AMD', purchasesEnabled: true, topUpsEnabled: false };
const mode = { balance: 'ok', status: 'AWAITING_CONFIRMATION' };
let lastIntent = null;
const fmt = (n) => Number(n).toFixed(4);
const buildIntent = (dto) => {
  const gross = Number(dto.grossAmount), bonus = Number(dto.bonusAmountRequested ?? 0), prepaid = Number(dto.prepaidAmountApplied ?? 0);
  return { id: 'pi-hybrid-1', customerId: 'user-1', partnerId: P, partnerBranchId: 'branch-1', status: 'AWAITING_CONFIRMATION', confirmationCode: '0042', grossAmount: fmt(gross), bonusAmountRequested: fmt(bonus), prepaidAmountApplied: fmt(prepaid), ordinaryPaymentRemainder: fmt(gross - bonus - prepaid), refundedAmount: '0.0000', paymentRoute: 'DIRECT_PARTNER', quantity: null, quantityUnit: null, unitPrice: null, contributionRuleKind: null, contributionRuleVersion: null, merchantApprovedAt: null, merchantApprovedByUserId: null, negotiatedRateBps: 500, maxBonusPaymentPercent: 50, partnerBrand: brand, confirmedByUserId: null, rejectedByUserId: null, rejectionReason: null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 170e3).toISOString(), confirmedAt: null, rejectedAt: null, cancelledAt: null };
};
const ok = (body, status = 200) => ({ status, body: { data: body } });
const log = [];
async function route(page) {
  await page.route('**/localhost:4999/**', async (r) => {
    const req = r.request(); const url = new URL(req.url()); const path = url.pathname.replace(/^\/v1/, ''); const m = req.method();
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    let res;
    if (path === '/health') res = ok({ status: 'ok', demoMode: false });
    else if (m === 'POST' && path === '/auth/login') res = ok({ user, tokens });
    else if (path === '/users/me') res = ok(user);
    else if (path === '/wallet/me') res = ok(wallet);
    else if (path === '/wallet/me/ledger' || path === '/transactions/me') res = ok({ items: [], nextCursor: null });
    else if (path === '/wallet/me/lots' || path === '/promos/featured' || path === '/ev/stations/nearby' || path === '/ev/stations') res = ok([]);
    else if (path === '/partners/nearby') res = ok([nearby]);
    else if (path === `/partners/${P}`) res = ok(detail);
    else if (path === '/balance/me') res = mode.balance === 'ok' ? ok(balance) : mode.balance === 'unavailable' ? { status: 404, body: { statusCode: 404, message: 'Not Found' } } : { status: 503, body: { statusCode: 503, message: 'upstream unavailable' } };
    else if (m === 'POST' && path === '/purchase-intents/quote') {
      const dto = JSON.parse(req.postData() || '{}'); const gross = Number(dto.grossAmount), bonus = Number(dto.bonusAmountRequested ?? 0), prepaid = Number(dto.prepaidAmountApplied ?? 0);
      const problems = []; if (prepaid > Number(balance.available)) problems.push({ code: 'PREPAID_EXCEEDS_AVAILABLE', message: 'Insufficient available balance' }); if (bonus + prepaid > gross) problems.push({ code: 'COMPONENTS_EXCEED_GROSS', message: 'x' });
      res = ok({ grossAmount: fmt(gross), bonusApplied: fmt(bonus), prepaidAmountApplied: fmt(prepaid), externalAmountDue: fmt(Math.max(0, gross - bonus - prepaid)), paymentRoute: 'DIRECT_PARTNER', availableBonus: wallet.availableBonus, maxBonusAllowed: fmt(gross / 2), prepaid: { state: 'AVAILABLE', availablePrepaidBalance: balance.available, reservedPrepaid: '0.0000' }, canProceed: problems.length === 0, problems });
    }
    else if (m === 'POST' && path === '/purchase-intents') { lastIntent = buildIntent(JSON.parse(req.postData() || '{}')); res = ok(lastIntent, 201); }
    else if (m === 'POST' && /^\/purchase-intents\/[^/]+\/cancel$/.test(path)) { lastIntent = { ...lastIntent, status: 'CANCELLED', cancelledAt: new Date().toISOString() }; res = ok(lastIntent); }
    else if (/^\/purchase-intents\/[^/]+$/.test(path)) res = ok({ ...lastIntent, status: mode.status, confirmedAt: mode.status === 'CONFIRMED' ? new Date().toISOString() : null, confirmedByUserId: mode.status === 'CONFIRMED' ? 'staff-1' : null });
    else if (/^\/psp\/purchases\//.test(path)) res = ok({ state: 'NOT_APPLICABLE', purchaseStatus: mode.status, canBeginPayment: false, reason: 'NOT_ROUTED' });
    else if (path.includes('notifications')) res = ok({ items: [], nextCursor: null, unreadCount: 0 });
    else { log.push(`${m} ${path}`); res = ok([]); }
    return r.fulfill({ status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(res.body) });
  });
}
const browser = await chromium.launch();
let ctx, page;
const name = (n) => `${out}/mobile-${tag ? tag + '-' : ''}${n}.png`;
const shot = async (n, full = false) => { await page.waitForTimeout(900); await page.screenshot({ path: name(n), fullPage: full }); console.log('shot', n); };
const tap = async (re) => { await page.getByText(re).first().click(); await page.waitForTimeout(900); };
async function session() {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ viewport: { width: Number(width), height: 800 }, hasTouch: true, locale: locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US' });
  page = await ctx.newPage(); page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await route(page);
  await page.goto(base, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await page.getByPlaceholder('00 000 000').fill('91000001');
  await page.getByPlaceholder('••••••••').fill('password-1');
  await tap(/^(Log in|Войти|Մուտք գործել)$/);
  await page.getByText(/Choose a code|Придумайте код|Ընտրեք կոդ/).waitFor({ timeout: 30000 });
  for (let r = 0; r < 2; r++) for (const d of ['2','0','2','6']) await page.getByTestId(`pin-key-${d}`).click();
  await page.waitForTimeout(2500);
}
async function openCreate() {
  await tap(/^(Map|Карта|Քարտեզ)$/);
  await page.waitForTimeout(1200);
  const item = page.getByText('Coffee Corner').first();
  await item.dispatchEvent('click'); await page.waitForTimeout(1200);
  await page.getByText(/^(Pay here|Оплатить здесь|Վճարել այստեղ)$/).first().dispatchEvent('click'); await page.waitForTimeout(1200);
  await page.getByText(/Amount|Сумма|Գումար/).first().waitFor({ timeout: 10000 });
}
const fields = async () => page.getByPlaceholder('0');
const fill = async (gross, bonus, prepaid) => {
  const f = await fields(); const n = await f.count();
  await f.nth(0).fill(gross); if (n > 1) await f.nth(1).fill(bonus); if (n > 2 && prepaid !== undefined) await f.nth(2).fill(prepaid);
  await page.waitForTimeout(1200);
};
// ── customer: checkout breakdowns ──
mode.balance = 'ok'; mode.status = 'AWAITING_CONFIRMATION';
await session(); await tap(/^(Wallet|Кошелёк|Դրամապանակ)$/); await shot('wallet-money-ok', true);
await tap(/^(Home|Главная|Գլխավոր)$/); await openCreate();
await fill('50000', '', ''); await shot('create-cash-only', true);
await fill('50000', '5000', ''); await shot('create-cash-bonus', true);
await fill('50000', '5000', '45000'); await shot('create-prepaid-bonus-nothing-at-till', true);
await fill('50000', '5000', '20000'); await shot('create-all-three', true);
await fill('50000', '5000', '60000'); await shot('create-prepaid-insufficient', true);
await fill('50000', '5000', '20000'); await tap(/^(Send to cashier|Отправить кассиру|Ուղարկել դրամարկղին)$/); await page.waitForTimeout(1500); await shot('status-awaiting-collect-25000', true);
mode.status = 'CONFIRMED'; await page.waitForTimeout(4500); await shot('status-confirmed-all-three', true);
// nothing at the till, then confirmed
mode.status = 'AWAITING_CONFIRMATION'; await session(); await openCreate(); await fill('50000', '5000', '45000');
await tap(/^(Send to cashier|Отправить кассиру|Ուղարկել դրամարկղին)$/); await page.waitForTimeout(1500); await shot('status-awaiting-nothing-at-till', true);
mode.status = 'CONFIRMED'; await page.waitForTimeout(4500); await shot('status-confirmed-paid-via-tutak', true);
// cancelled
mode.status = 'AWAITING_CONFIRMATION'; await session(); await openCreate(); await fill('50000', '', '20000');
await tap(/^(Send to cashier|Отправить кассиру|Ուղարկել դրամարկղին)$/); await page.waitForTimeout(1500);
await tap(/^(Cancel this purchase|Отменить покупку|Չեղարկել գնումը)$/); await page.waitForTimeout(600);
const confirmCancel = page.getByText(/^(Cancel this purchase|Отменить покупку|Չեղարկել գնումը)$/).last(); await confirmCancel.click().catch(() => {}); mode.status = 'CANCELLED'; await page.waitForTimeout(2500); await shot('status-cancelled', true);
if (locale === 'en' && width === '390') {
  // balance unavailable / unknown
  mode.balance = 'unavailable'; mode.status = 'AWAITING_CONFIRMATION'; await session(); await tap(/^(Wallet|Кошелёк|Դրամապանակ)$/); await shot('wallet-money-unavailable', true);
  await tap(/^(Home|Главная|Գլխավոր)$/); await openCreate(); await fill('50000', '5000', undefined); await shot('create-balance-unavailable', true);
  mode.balance = 'fail'; await session(); await tap(/^(Wallet|Кошелёк|Դրամապանակ)$/); await shot('wallet-money-unknown', true);
  await tap(/^(Home|Главная|Գլխավոր)$/); await openCreate(); await fill('50000', '5000', ''); await shot('create-balance-unknown', true);
}
await ctx.close(); await browser.close();
console.log('unmatched', [...new Set(log)]);
