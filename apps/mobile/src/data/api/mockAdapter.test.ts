import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InternalAxiosRequestConfig } from 'axios';
import { mockAdapter, normalisePath, resetMockState } from './mockAdapter';

/**
 * The preview app is the first thing anybody sees of this product, and it is
 * served entirely by this adapter. Two things have to hold.
 *
 * **The envelope.** The API wraps every response as `{ data, timestamp }` and
 * the client unwraps it. A mock that returned the payload bare would work in
 * the preview and prove nothing about the app — worse, it would hide the
 * exact defect that shipped twice here, where a caller read one level too
 * few and the screen silently showed nothing.
 *
 * **The route list.** An endpoint with no mock returns 404 rather than
 * `undefined`, so a screen added later fails loudly instead of rendering an
 * empty shell that somebody has to diagnose from a phone.
 */

function request(method: string, url: string, data?: unknown): InternalAxiosRequestConfig {
  return {
    method,
    url,
    baseURL: 'http://offline.invalid/v1',
    data: data === undefined ? undefined : JSON.stringify(data),
    headers: {},
  } as unknown as InternalAxiosRequestConfig;
}

const call = (method: string, url: string, data?: unknown) =>
  mockAdapter(request(method, url, data));

describe('normalisePath', () => {
  it('strips the base URL and the version prefix', () => {
    expect(normalisePath(request('get', '/wallet/me'))).toBe('/wallet/me');
  });

  it('handles an absolute URL, which is how the health probe is asked', () => {
    expect(normalisePath(request('get', 'http://offline.invalid/health'))).toBe('/health');
  });

  it('drops the query string, so a paged request hits the same route', () => {
    expect(normalisePath(request('get', '/transactions/me?limit=20&cursor=abc'))).toBe(
      '/transactions/me',
    );
  });
});

describe('mockAdapter', () => {
  beforeEach(() => resetMockState());

  it('wraps every response in the envelope the real API sends', async () => {
    const response = await call('get', '/wallet/me');

    // Not `response.data.availableBonus` — the payload is one level in, and
    // the client's unwrapping depends on it.
    expect(response.data).toHaveProperty('timestamp');
    expect(response.data.data.availableBonus).toBe('377.5');
  });

  it('reports demo mode, which is what offers a way in without an account', async () => {
    const response = await call('get', 'http://offline.invalid/health');
    expect(response.data.data).toEqual({ status: 'ok', demoMode: true });
  });

  it('accepts any credentials, because there is nothing to authenticate against', async () => {
    const response = await call('post', '/auth/login', {
      phone: '+37400000000',
      password: 'whatever',
      deviceId: 'd',
    });

    expect(response.data.data.user.phone).toBe('+37477100001');
    expect(response.data.data.tokens.accessToken).toBeTruthy();
  });

  it('answers every route the app actually calls', async () => {
    // The list is the app's, not this file's invention: it is what
    // `httpClient` is asked for across data/api. A 404 here means a screen
    // that renders empty on a phone.
    const routes: Array<[string, string]> = [
      ['get', 'http://offline.invalid/health'],
      ['get', '/wallet/me'],
      ['get', '/wallet/me/ledger'],
      ['get', '/wallet/me/lots'],
      ['get', '/transactions/me'],
      ['get', '/referral/me/code'],
      ['get', '/referral/me/invites'],
      ['get', '/notifications/me'],
      ['get', '/ev/stations'],
      ['get', '/ev/stations/nearby'],
      ['get', '/ev/sessions/me'],
      ['get', '/ev/reservations/me'],
      ['post', '/auth/register'],
      ['post', '/auth/demo-session'],
      ['post', '/auth/refresh'],
      ['post', '/auth/logout'],
      ['post', '/auth/change-password'],
      ['post', '/auth/password-reset/request'],
      ['post', '/auth/password-reset/confirm'],
      ['post', '/auth/verify-phone/request'],
      ['post', '/auth/verify-phone/confirm'],
      ['post', '/notifications/read-all'],
      ['post', '/notifications/note-1/read'],
      ['post', '/notifications/push-token'],
      ['post', '/qr/issue'],
      ['post', '/qr/redeem'],
      ['post', '/ev/sessions/start'],
      ['post', '/ev/sessions/session-1/stop'],
      ['post', '/ev/reservations'],
      ['delete', '/users/me'],
    ];

    for (const [method, url] of routes) {
      const response = await call(method, url, { connectorId: 'conn-1', amount: '100' });
      expect([method, url, response.status]).toEqual([method, url, 200]);
    }
  });

  it('answers every route the api modules can ask for, including future ones', async () => {
    // The list above is written by hand and will go stale the day somebody
    // adds an endpoint. This reads the sibling files instead, so a new call
    // with no mock behind it fails here rather than on a phone.
    const dir = __dirname;
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'));

    const calls = new Set<string>();
    const pattern = /httpClient\.(get|post|patch|put|delete)(?:<[^(]*?>)?\(\s*([`'])([^`']+)\2/g;
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const match of source.matchAll(pattern)) {
        // `/notifications/${id}/read` — substitute something concrete.
        const path = match[3].replace(/\$\{[^}]+\}/g, 'sample-id');
        calls.add(`${match[1]} ${path}`);
      }
    }

    expect(calls.size).toBeGreaterThan(20);

    const unmocked: string[] = [];
    for (const entry of calls) {
      const [method, path] = entry.split(' ');
      const response = await call(method!, path!, { connectorId: 'conn-1', amount: '100' }).catch(
        (error: { response?: { status?: number } }) => error.response,
      );
      if (response?.status !== 200) unmocked.push(entry);
    }

    expect(unmocked).toEqual([]);
  });

  it('rejects an unknown route instead of resolving with nothing', async () => {
    // Resolving would give the caller `undefined` and a blank screen. The
    // app's error handling is built on axios rejecting a non-2xx.
    await expect(call('get', '/does/not/exist')).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 404 },
    });
  });

  describe('the partner map', () => {
    /*
     * The chips and the search box are the demo's most easily faked controls:
     * hand back all twelve partners regardless and they appear to work while
     * doing nothing at all. These go through `config.params`, which is what
     * `partnersApi` actually sends.
     */
    const nearby = (params: Record<string, unknown> = {}) =>
      mockAdapter({
        ...request('get', '/partners/nearby'),
        params: { lat: 40.1776, lng: 44.5126, radiusKm: 25, ...params },
      } as InternalAxiosRequestConfig);

    it('returns the nearest partner first', async () => {
      const rows = (await nearby()).data.data as Array<{ distanceKm: number }>;
      expect(rows.length).toBeGreaterThan(5);

      const distances = rows.map((r) => r.distanceKm);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
    });

    it('puts each partner somewhere different, so the map is not one stack', async () => {
      const rows = (await nearby()).data.data as Array<{ latitude: number; longitude: number }>;
      const points = new Set(rows.map((r) => `${r.latitude},${r.longitude}`));
      expect(points.size).toBe(rows.length);
    });

    it('filters by category', async () => {
      const rows = (await nearby({ category: 'cafe' })).data.data as Array<{ category: string }>;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.category === 'cafe')).toBe(true);
    });

    it('searches the name, the branch and the street, case-insensitively', async () => {
      const byName = (await nearby({ q: 'SAS' })).data.data as Array<{ name: string }>;
      expect(byName.every((r) => r.name.toLowerCase().includes('sas'))).toBe(true);
      expect(byName.length).toBeGreaterThan(0);

      const byStreet = (await nearby({ q: 'комитаса' })).data.data as unknown[];
      expect(byStreet.length).toBeGreaterThan(0);
    });

    it('honours the radius', async () => {
      const all = (await nearby({ radiusKm: 25 })).data.data as unknown[];
      const close = (await nearby({ radiusKm: 1 })).data.data as Array<{ distanceKm: number }>;

      expect(close.length).toBeLessThan(all.length);
      expect(close.every((r) => r.distanceKm <= 1)).toBe(true);
    });

    it('finds nothing for a search that matches nothing, rather than everything', async () => {
      // An empty-string check written the wrong way round turns "no match"
      // into "no filter", which reads to a tester as a search box that does
      // not work at all.
      const rows = (await nearby({ q: 'zzzzz' })).data.data as unknown[];
      expect(rows).toEqual([]);
    });
  });

  it('moves the wallet when a QR code is paid, so the preview is not inert', async () => {
    const before = (await call('get', '/wallet/me')).data.data.availableBonus;

    await call('post', '/qr/redeem', { token: 'X', idempotencyKey: 'k' });

    const after = (await call('get', '/wallet/me')).data.data.availableBonus;
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  it('marks one notification read without touching the others', async () => {
    await call('post', '/notifications/note-1/read');

    const items = (await call('get', '/notifications/me')).data.data.items;
    expect(items.find((n: { id: string }) => n.id === 'note-1').isRead).toBe(true);
    expect(items.find((n: { id: string }) => n.id === 'note-2').isRead).toBe(false);
  });

  it('completes a charging session and credits the points it earned', async () => {
    const before = Number((await call('get', '/wallet/me')).data.data.availableBonus);

    const stopped = (await call('post', '/ev/sessions/session-1/stop')).data.data;
    expect(stopped.status).toBe('COMPLETED');
    expect(stopped.stoppedAt).toBeTruthy();

    const after = Number((await call('get', '/wallet/me')).data.data.availableBonus);
    expect(after).toBeGreaterThan(before);
  });

  it('starts from the same state each time the app is opened', async () => {
    await call('post', '/qr/redeem', { token: 'X', idempotencyKey: 'k' });
    resetMockState();

    expect((await call('get', '/wallet/me')).data.data.availableBonus).toBe('377.5');
  });

  it('keeps the wallet consistent with the history it shows', async () => {
    // A preview whose numbers do not add up teaches the wrong thing about
    // the product. Available is the sum of the lots that are available.
    const wallet = (await call('get', '/wallet/me')).data.data;
    const lots = (await call('get', '/wallet/me/lots')).data.data;

    const availableFromLots = lots
      .filter((l: { status: string }) => l.status === 'AVAILABLE')
      .reduce((total: number, l: { remainingAmount: string }) => total + Number(l.remainingAmount), 0);
    const pendingFromLots = lots
      .filter((l: { status: string }) => l.status === 'PENDING')
      .reduce((total: number, l: { remainingAmount: string }) => total + Number(l.remainingAmount), 0);

    expect(availableFromLots).toBe(Number(wallet.availableBonus));
    expect(pendingFromLots).toBe(Number(wallet.pendingBonus));
  });

  it('includes the transfer entries that are neither a gain nor a loss', async () => {
    // RESERVE_HOLD and PENDING_PROMOTION are the rows the wallet screen used
    // to render as deductions. A preview that omitted them could not show
    // whether that is fixed.
    const items = (await call('get', '/wallet/me/ledger')).data.data.items;
    const neutral = items.filter((e: { direction: string }) => e.direction === 'NEUTRAL');

    expect(neutral.map((e: { type: string }) => e.type).sort()).toEqual([
      'PENDING_PROMOTION',
      'RESERVE_HOLD',
    ]);
  });
});
