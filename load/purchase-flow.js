import http from 'k6/http';
import { check, group } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * Горячий путь покупки: создание намерения и подтверждение кассиром.
 *
 * Это самый дорогой путь в системе на одну операцию: подтверждение открывает
 * транзакцию, которая пишет проводки в реестр, расходует бонусный резерв,
 * начисляет бонус, продвигает отложенные лоты и платит реферальные доли —
 * всё в одном коммите. Если что-то упирается в пул соединений или в
 * блокировку строки, упрётся здесь.
 */

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) {
  throw new Error(
    'BASE_URL is required and has no default on purpose — a forgotten localhost default ' +
      'is one tunnel away from being production.',
  );
}

const confirmDuration = new Trend('purchase_confirm_duration', true);

export const options = {
  scenarios: {
    // Ramp rather than a step: a step to full load measures cold caches and
    // an empty connection pool as if they were steady state.
    steady: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '2m', target: 10 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Zero, not "under 1%". One percent of failed confirmations is one
    // customer in a hundred standing at a till with a purchase that will not
    // complete, and for them it is not one percent.
    'http_req_failed{path:confirm}': ['rate==0'],
    'http_req_failed{path:create}': ['rate==0'],
    'purchase_confirm_duration': ['p(95)<1500'],
    'http_req_duration{path:create}': ['p(95)<1500'],
  },
};

/**
 * Tokens are supplied, never minted here.
 *
 * A load script that could sign its own tokens would need the signing secret,
 * and a secret in a load script is a secret in a repository. Generate them
 * with a seeding step and pass them in.
 */
const CUSTOMER_TOKEN = __ENV.CUSTOMER_TOKEN;
const STAFF_TOKEN = __ENV.STAFF_TOKEN;
const PARTNER_ID = __ENV.PARTNER_ID;

export default function () {
  const customer = { headers: authHeaders(CUSTOMER_TOKEN) };
  const staff = { headers: authHeaders(STAFF_TOKEN) };

  group('purchase', () => {
    const created = http.post(
      `${BASE_URL}/purchase-intents`,
      JSON.stringify({ partnerId: PARTNER_ID, grossAmount: '5000', bonusAmountRequested: '0' }),
      { ...customer, tags: { path: 'create' } },
    );
    const ok = check(created, { 'intent created': (r) => r.status === 201 || r.status === 200 });
    if (!ok) return;

    const intentId = created.json('data.id');
    const confirmed = http.post(`${BASE_URL}/purchase-intents/${intentId}/confirm`, null, {
      ...staff,
      tags: { path: 'confirm' },
    });
    check(confirmed, { 'intent confirmed': (r) => r.status === 200 || r.status === 201 });
    confirmDuration.add(confirmed.timings.duration);
  });
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}
