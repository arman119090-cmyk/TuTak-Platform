import http from 'k6/http';
import { check } from 'k6';

/**
 * «Партнёры рядом» — самое частое чтение в приложении.
 *
 * Открывается на каждом запуске и повторяется при каждом движении карты, то
 * есть создаёт на порядок больше запросов, чем покупки. Геозапрос с
 * сортировкой по расстоянию — единственное место, где чтение может стать
 * дороже записи, поэтому у него отдельный сценарий и отдельные пороги.
 */

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) throw new Error('BASE_URL is required and has no default on purpose');

const TOKEN = __ENV.CUSTOMER_TOKEN;

export const options = {
  scenarios: {
    browsing: {
      executor: 'constant-arrival-rate',
      // Arrival-rate, not VUs: what matters is how the service behaves at a
      // given request rate, and a VU-based model quietly reduces the rate as
      // responses slow down — hiding exactly the degradation being measured.
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

// Yerevan, moved slightly per iteration so every request is a different
// query: a fixed point would measure the database's cache and call it
// throughput.
const CENTRE = { lat: 40.1792, lon: 44.4991 };

export default function () {
  const jitter = () => (Math.random() - 0.5) * 0.05;
  const url =
    `${BASE_URL}/partners/nearby` +
    `?latitude=${(CENTRE.lat + jitter()).toFixed(5)}` +
    `&longitude=${(CENTRE.lon + jitter()).toFixed(5)}&radiusKm=5`;

  const res = http.get(url, {
    headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
  });
  check(res, { 'nearby returned': (r) => r.status === 200 });
}
