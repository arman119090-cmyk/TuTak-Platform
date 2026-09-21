import { chromium } from '@playwright/test';
const [,, port = '3011', out = 'docs/screenshots/hybrid'] = process.argv;
const base = `http://localhost:${port}`;
const CORS = { 'Access-Control-Allow-Origin': `http://localhost:${port}`, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-device-id,x-request-id', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
const P = 'partner-1';
const user = { id: 'user-1', phone: '+37491000001', email: null, firstName: 'Anna', lastName: 'Owner', roles: ['PARTNER_OWNER'], partnerScopes: { PARTNER_OWNER: [P] }, locale: 'en', isPhoneVerified: true, avatar: null, showAvatarInReferralList: false, personalizedRecommendationsEnabled: false, mustChangePassword: false };
const tokens = { accessToken: 'stub-access', refreshToken: 'stub-refresh', accessTokenExpiresAt: new Date(Date.now()+3600e3).toISOString(), refreshTokenExpiresAt: new Date(Date.now()+86400e3).toISOString() };
const position = { partnerId: P, accrued: '25000.0000', deductions: '2500.0000', net: '22500.0000', entries: [], unrecognised: [], ledgerBalance: '22500.0000', inOpenSettlements: '0.0000', underReview: '0.0000', paidTotal: '120000.0000', asOf: new Date().toISOString(), funding: { salesGross: '150000.0000', receivedDirectly: '95000.0000', fundedByPrepaid: '45000.0000', fundedByBonus: '10000.0000', contribution: '7500.0000', refundedGross: '0.0000', owedToTuTak: '0.0000', collectionsConfirmed: '0.0000' } };
const intent = (id, code, gross, bonus, prepaid) => ({ id, customerId: 'c-'+id, partnerId: P, partnerBranchId: null, status: 'AWAITING_CONFIRMATION', grossAmount: gross, bonusAmountRequested: bonus, prepaidAmountApplied: prepaid, ordinaryPaymentRemainder: String(Number(gross)-Number(bonus)-Number(prepaid)), refundedAmount: '0', confirmationCode: code, rejectedByUserId: null, cancelledAt: null, negotiatedRateBps: 500, maxBonusPaymentPercent: 50, paymentRoute: 'DIRECT_PARTNER', quantity: null, quantityUnit: null, unitPrice: null, contributionRuleKind: null, contributionRuleVersion: null, merchantApprovedAt: null, merchantApprovedByUserId: null, partnerBrand: { partnerId: P, displayName: 'Coffee Corner', logo: null }, confirmedByUserId: null, rejectionReason: null, createdAt: new Date(Date.now()-40e3).toISOString(), expiresAt: new Date(Date.now()+140e3).toISOString(), confirmedAt: null, rejectedAt: null });
let pendingExternal = [{ id: 'rf-1', purchaseIntentId: 'aaaaaaaa-bbbb-cccc-dddd-eeee12345678', confirmationCode: '0042', purchaseGross: '50000.0000', amount: '10000.0000', bonusRestored: '1000.0000', prepaidRestored: '4000.0000', externalRefundDue: '5000.0000', externalRefundStatus: 'PENDING_PARTNER', reason: 'Wrong size', createdAt: '2026-09-20T10:00:00.000Z' }];
const ok = (body) => ({ status: 200, body: { data: body } });
const log = [];
async function route(page) {
  await page.route('**/localhost:4010/**', async (r) => {
    const req = r.request(); const url = new URL(req.url()); const path = url.pathname.replace(/^\/v1/, ''); const m = req.method();
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    let res;
    if (m === 'POST' && path === '/auth/login') res = ok({ user, tokens });
    else if (path === `/partners/${P}`) res = ok({ id: P, displayName: 'Coffee Corner', isActive: true, taxId: '01234567', bonusAccrualRateBps: 500, maxBonusPaymentPercent: 50 });
    else if (path === `/partner/settlements/${P}/position`) res = ok(position);
    else if (path === `/partner/settlements/${P}`) res = ok([]);
    else if (m === 'GET' && path === '/purchase-intents/refunds/pending-external') res = ok(pendingExternal);
    else if (m === 'POST' && /^\/purchase-intents\/refunds\/[^/]+\/confirm-external$/.test(path)) { pendingExternal = []; res = ok({ id: 'rf-1', externalRefundStatus: 'CONFIRMED' }); }
    else if (m === 'GET' && path === '/purchase-intents') { const status = url.searchParams.get('status'); res = status === 'CONFIRMED' ? ok([{ ...intent('ffffffff-1111-2222-3333-444455556666', '0042', '50000', '5000', '20000'), status: 'CONFIRMED', confirmedAt: '2026-09-20T09:10:00.000Z' }]) : ok([intent('11111111-1111-2222-3333-444455556666', '0042', '50000', '5000', '20000'), intent('22222222-1111-2222-3333-444455556666', '0077', '50000', '5000', '45000'), intent('33333333-1111-2222-3333-444455556666', '0913', '50000', '0', '0')]); }
    else if (m === 'GET' && path === '/purchase-intent-refund-requests') res = ok([]);
    else if (path === `/payouts/partners/${P}/balance`) res = ok({ availableBalance: '22500.00', currency: 'AMD' });
    else if (path === '/purchase-intents/activity/daily') res = ok([]);
    else { log.push(`${m} ${path}`); res = ok([]); }
    return r.fulfill({ status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(res.body) });
  });
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
await route(page);
const shot = async (name) => { await page.waitForTimeout(800); await page.screenshot({ path: `${out}/partner-${name}.png`, fullPage: true }); console.log('shot', name); };
await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('+374 00 000 000').fill('+37491000001');
await page.getByPlaceholder('••••••••').fill('password-1');
await page.getByRole('button', { name: /log in|sign in/i }).click();
await page.waitForURL(`${base}/`, { timeout: 20000 }).catch(() => {});
// The session token lives in memory, so every page is reached through the
// sidebar rather than a fresh load.
const go = async (label) => { await page.getByRole('link', { name: label }).first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200); };
await go('Purchase requests'); await shot('queue-collect-25000-and-0');
await go('Settlements'); await shot('settlements-where-paid-from');
await go('Returns'); await shot('refunds-cash-to-hand-back');
await page.getByRole('button', { name: /confirm cash returned/i }).first().click(); await page.waitForTimeout(1500); await shot('refunds-cash-confirmed');
await ctx.close(); await browser.close();
console.log('unmatched', [...new Set(log)]);
