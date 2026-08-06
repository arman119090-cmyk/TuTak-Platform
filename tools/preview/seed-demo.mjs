/**
 * Populates the running instance with realistic data purely through the
 * public API, so preview screenshots show real content instead of empty
 * states. Creates nothing the product cannot create by itself — no direct
 * database writes, no fixtures baked into the UI.
 *
 * Usage: node tools/preview/seed-demo.mjs
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/v1';

const post = async (path, body, token) => {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json.data;
};

const get = async (path, token) => {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return json.data;
};

const rid = Date.now().toString().slice(-7);

async function main() {
  // ── Admin ───────────────────────────────────────────────────────────
  const admin = await post('/auth/login', {
    phone: '+37400000000',
    password: 'ChangeMe123!',
    deviceId: 'preview-admin',
  });
  const A = admin.tokens.accessToken;
  console.log('✓ admin signed in');

  // ── Demo customer ───────────────────────────────────────────────────
  const custPhone = `+3747${rid}`;
  const cust = await post('/auth/register', {
    phone: custPhone,
    password: 'Passw0rd!23',
    firstName: 'Ani',
    lastName: 'Petrosyan',
    locale: 'en',
    deviceId: 'preview-cust',
  });
  const C = cust.tokens.accessToken;
  const custId = cust.user.id;
  console.log('✓ customer created', custPhone);

  // Give the wallet a spendable balance.
  await post(
    '/wallet/admin/adjust',
    { userId: custId, amount: '18400', direction: 'CREDIT', reason: 'Welcome campaign credit' },
    A,
  );

  // ── Partner business owned by the demo partner user ─────────────────
  const partnerPhone = `+3746${rid}`;
  const partnerUser = await post('/auth/register', {
    phone: partnerPhone,
    password: 'Passw0rd!23',
    firstName: 'Narek',
    lastName: 'Sargsyan',
    locale: 'en',
    deviceId: 'preview-partner',
  });

  const partner = await post(
    '/partners',
    {
      legalName: 'Jazzve Coffee LLC',
      displayName: 'Jazzve Coffee',
      taxId: `AM${rid}`,
      category: 'cafe',
      bonusAccrualRateBps: 500,
      ownerUserId: partnerUser.user.id,
    },
    A,
  );
  console.log('✓ partner created', partner.displayName);

  const partner2 = await post(
    '/partners',
    {
      legalName: 'SAS Supermarket CJSC',
      displayName: 'SAS Supermarket',
      taxId: `AM2${rid}`,
      category: 'retail',
      bonusAccrualRateBps: 300,
      ownerUserId: partnerUser.user.id,
    },
    A,
  );

  // ── A spread of payments so history + analytics look real ───────────
  const payments = [
    { partner: partner.id, amount: '4200', bonus: '0' },
    { partner: partner.id, amount: '7800', bonus: '2000' },
    { partner: partner2.id, amount: '15600', bonus: '0' },
    { partner: partner.id, amount: '3100', bonus: '1100' },
    { partner: partner2.id, amount: '22400', bonus: '5000' },
  ];

  for (const [i, p] of payments.entries()) {
    const qr = await post(
      '/qr/issue',
      { type: 'DYNAMIC_INVOICE', partnerId: p.partner, amount: p.amount, expiresInSeconds: 900 },
      A,
    );
    await post(
      '/qr/redeem',
      {
        token: qr.token,
        bonusAmountToApply: p.bonus !== '0' ? p.bonus : undefined,
        idempotencyKey: `preview-${rid}-${i}`,
      },
      C,
    );
  }
  console.log(`✓ ${payments.length} payments completed`);

  // ── EV: station, connectors, and a finished charging session ────────
  const station = await post(
    '/ev/stations',
    {
      partnerId: partner.id,
      name: 'Republic Square',
      address: '1 Republic Square',
      city: 'Yerevan',
      latitude: 40.1776,
      longitude: 44.5126,
    },
    A,
  );
  const c1 = await post(
    '/ev/connectors',
    { stationId: station.id, connectorType: 'CCS2', powerKw: 60, pricePerKwh: 95 },
    A,
  );
  await post(
    '/ev/connectors',
    { stationId: station.id, connectorType: 'TYPE_2', powerKw: 22, pricePerKwh: 78 },
    A,
  );

  const station2 = await post(
    '/ev/stations',
    {
      partnerId: partner2.id,
      name: 'Cascade Complex',
      address: '10 Tamanyan St',
      city: 'Yerevan',
      latitude: 40.1912,
      longitude: 44.5152,
    },
    A,
  );
  await post(
    '/ev/connectors',
    { stationId: station2.id, connectorType: 'CHADEMO', powerKw: 50, pricePerKwh: 88 },
    A,
  );

  // One completed session for the customer's charging history.
  const session = await post('/ev/sessions/start', { connectorId: c1.id }, C);
  await post(`/ev/sessions/${session.id}/meter-value`, { energyKwh: '23.4' }, C);
  await post(`/ev/sessions/${session.id}/stop`, {}, C);
  console.log('✓ EV stations + completed session');

  // ── Referral: an invited friend who has paid (so it shows REWARDED) ──
  const code = await get('/referral/me/code', C);
  const friend = await post('/auth/register', {
    phone: `+3745${rid}`,
    password: 'Passw0rd!23',
    firstName: 'Davit',
    lastName: 'Hakobyan',
    locale: 'en',
    deviceId: 'preview-friend',
    referralCode: code.code,
  });
  const friendQr = await post(
    '/qr/issue',
    { type: 'DYNAMIC_INVOICE', partnerId: partner.id, amount: '5400' },
    A,
  );
  await post(
    '/qr/redeem',
    { token: friendQr.token, idempotencyKey: `preview-${rid}-friend` },
    friend.tokens.accessToken,
  );
  console.log('✓ referral rewarded');

  const wallet = await get('/wallet/me', C);
  console.log('\nDemo customer wallet:', {
    available: wallet.availableBonus,
    pending: wallet.pendingBonus,
    reserved: wallet.reservedBonus,
  });

  console.log('\n--- credentials for preview ---');
  console.log(JSON.stringify(
    {
      admin: { phone: '+37400000000', password: 'ChangeMe123!' },
      partner: { phone: partnerPhone, password: 'Passw0rd!23', partnerId: partner.id },
      customer: { phone: custPhone, password: 'Passw0rd!23', userId: custId },
    },
    null,
    2,
  ));
}

main().catch((e) => {
  console.error('SEED FAILED:', e.message);
  process.exit(1);
});
