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

/**
 * A request whose body is passed through untouched.
 *
 * `request` above JSON-stringifies, which is what axios does to a plain
 * object. It is *not* what axios does to a `FormData`: that is handed to the
 * adapter as-is so the transport can stream it. The upload tests need the
 * real thing.
 */
const callRaw = (method: string, url: string, data: unknown) =>
  mockAdapter({
    method,
    url,
    baseURL: 'http://offline.invalid/v1',
    data,
    headers: {},
  } as unknown as InternalAxiosRequestConfig);

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

    /**
     * Routes that legitimately refuse the synthetic JSON body below.
     *
     * `PUT /users/me/avatar` is `multipart/form-data` with a picked file in
     * it; handed `{ connectorId, amount }` it answers 400 "No image was
     * uploaded", which is the mock working correctly rather than the mock
     * being absent. What this test is actually for is catching a route with
     * *no handler at all*, so for these the bar is "not a 404" — and the
     * upload path's own success case is covered directly, below.
     */
    const REJECTS_A_SYNTHETIC_BODY = new Set(['put /users/me/avatar']);

    const unmocked: string[] = [];
    for (const entry of calls) {
      const [method, path] = entry.split(' ');
      const response = await call(method!, path!, { connectorId: 'conn-1', amount: '100' }).catch(
        (error: { response?: { status?: number } }) => error.response,
      );
      const acceptable = REJECTS_A_SYNTHETIC_BODY.has(entry)
        ? response?.status !== undefined && response.status !== 404
        : response?.status === 200;
      if (!acceptable) unmocked.push(entry);
    }

    expect(unmocked).toEqual([]);
  }, 15000); // Every discovered route pays LATENCY_MS in sequence; the route count keeps growing.

  /**
   * The avatar upload, driven the way the app drives it.
   *
   * The mock echoes back the local URI the picker produced rather than
   * inventing a URL — see the handler's own docblock for why that is the only
   * honest option with no server behind it. Worth a test of its own because
   * the two runtimes disagree about what a `FormData` is (React Native keeps
   * `_parts`; the DOM's returns the entry from `get`), and the handler has to
   * read both.
   */
  it('stores and returns a picked avatar, then removes it', async () => {
    // React Native's own FormData shape. jsdom's `FormData` would stringify a
    // plain object to "[object Object]" rather than keeping it, which is
    // exactly why `usersApi.uploadAvatar` branches on the implementation —
    // this asserts the native branch, the one a phone actually takes.
    const form = { _parts: [['file', { uri: 'file:///tmp/me.jpg', name: 'me.jpg', type: 'image/jpeg' }]] };

    const uploaded = await callRaw('put', '/users/me/avatar', form);
    expect(uploaded.status).toBe(200);
    expect(uploaded.data.data).toMatchObject({ url: 'file:///tmp/me.jpg' });

    const me = await call('get', '/users/me');
    expect(me.data.data.avatar.url).toBe('file:///tmp/me.jpg');

    const removed = await call('delete', '/users/me/avatar');
    expect(removed.data.data.removedAssetId).toEqual(expect.any(String));
    expect((await call('get', '/users/me')).data.data.avatar).toBeNull();
  });

  it('records the Level-1 avatar consent decision, defaulting to off', async () => {
    expect((await call('get', '/users/me')).data.data.showAvatarInReferralList).toBe(false);
    const on = await call('patch', '/users/me/avatar-consent', { showAvatarInReferralList: true });
    expect(on.data.data.showAvatarInReferralList).toBe(true);
    expect((await call('get', '/users/me')).data.data.showAvatarInReferralList).toBe(true);
  });

  it('rejects an unknown route instead of resolving with nothing', async () => {
    // Resolving would give the caller `undefined` and a blank screen. The
    // app's error handling is built on axios rejecting a non-2xx.
    await expect(call('get', '/does/not/exist')).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 404 },
    });
  });

  describe('purchase intents', () => {
    afterEach(() => jest.useRealTimers());

    /**
     * NEXT_CLAUDE_TASK.md item 12 / audit issue #28: the demo auto-confirm
     * used to credit the *entire* contribution pool as GREEN — for a 5%
     * partner rate on a 10,000 gross purchase that was 500, when the
     * canonical split (20/30/20/30) makes only 20% of the pool immediately
     * available, i.e. 100. Pinned to `partner-sas`'s real mock rate (5%,
     * `cashbackPercent: 5` in mockData.ts) so this fails the moment either
     * number drifts.
     */
    it('credits the canonical 20% GREEN share on auto-confirm, not the whole contribution pool', async () => {
      const created = (
        await call('post', '/purchase-intents', { partnerId: 'partner-sas', grossAmount: '10000' })
      ).data.data;
      expect(created.negotiatedRateBps).toBe(500); // pool = 10000 * 5% = 500

      const before = Number((await call('get', '/wallet/me')).data.data.availableBonus);

      // Fakes only `Date`, not `setTimeout` — the adapter's own LATENCY_MS
      // delay still needs real timers to resolve, or every `call()` below
      // hangs forever waiting on a `setTimeout` that fake time never fires.
      jest.useFakeTimers({ doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'clearTimeout'] });
      jest.setSystemTime(Date.now() + 5000);
      const confirmed = (await call('get', `/purchase-intents/${created.id}`)).data.data;
      jest.useRealTimers();

      expect(confirmed.status).toBe('CONFIRMED');
      const after = Number((await call('get', '/wallet/me')).data.data.availableBonus);
      const credited = Math.round((after - before) * 100) / 100;

      expect(credited).toBe(100); // 20% of the 500 pool
      expect(credited).not.toBe(500); // the pre-fix value (the whole pool)
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
