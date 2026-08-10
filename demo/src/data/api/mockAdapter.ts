import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { EvSessionStatus, QrCodeStatus, QrCodeType } from '@tutak/shared-types';
import { MOCK_USER, freshMockState, mockTokens, type MockState } from './mockData';

/**
 * Serves the app from memory instead of from a server.
 *
 * ## Why an axios adapter and not a mocked API module
 *
 * The alternative was a branch in each of the eight files under `data/api`,
 * or a second set of them. Both mean the preview exercises different code
 * from the product, and the first thing a preview is used for is deciding
 * whether the product is right — so it has to be the same code. An adapter is
 * the transport, and the transport is the only honest place to cut: every
 * interceptor, every envelope, every DTO, every screen and every store above
 * this line is exactly what talks to the real API.
 *
 * That is also why the responses below are wrapped in `{ data, timestamp }`.
 * The API's transform interceptor does that to every response, the client
 * unwraps it, and a mock that skipped the envelope would hide precisely the
 * class of bug that has already shipped twice here.
 *
 * ## Switched on by configuration, never by build type
 *
 * `app.json` in `demo/` sets `extra.useMocks`. Nothing infers it from
 * `__DEV__` — a development build pointed at a real API must reach that API,
 * and a preview must never reach one by accident.
 */

/** Enough delay for a loading state to be visible, not enough to be a wait. */
const LATENCY_MS = 140;

let state: MockState = freshMockState();

/** Exposed for tests; the app never calls it. */
export function resetMockState(): void {
  state = freshMockState();
}

function envelope(data: unknown, status = 200) {
  return { body: { data, timestamp: new Date().toISOString() }, status };
}

/** The path, with the base URL and any query string removed. */
export function normalisePath(config: InternalAxiosRequestConfig): string {
  const raw = config.url ?? '';
  const absolute = /^https?:\/\//i.test(raw)
    ? raw.replace(/^https?:\/\/[^/]+/i, '')
    : `${(config.baseURL ?? '').replace(/^https?:\/\/[^/]+/i, '')}${raw}`;
  const withoutQuery = absolute.split('?')[0] ?? '';
  // The version prefix is not part of what distinguishes one route from
  // another here, and `/health` deliberately has none.
  return withoutQuery.replace(/^\/v\d+/, '') || '/';
}

function body<T>(config: InternalAxiosRequestConfig): T {
  if (typeof config.data === 'string') {
    try {
      return JSON.parse(config.data) as T;
    } catch {
      return {} as T;
    }
  }
  return (config.data ?? {}) as T;
}

function paged<T>(items: T[]) {
  return { items, nextCursor: null, total: items.length };
}

function sum(a: string, b: string): string {
  // The API sends decimals as strings and so does this. Rounding to two
  // places keeps a preview from inventing 377.49999999999994.
  return String(Math.round((Number(a) + Number(b)) * 100) / 100);
}

/**
 * Every route the app calls. Anything missing is a 404 rather than a silent
 * `undefined`, so a screen added later fails loudly in the preview instead of
 * rendering an empty shell nobody can explain.
 */
function handle(
  method: string,
  path: string,
  config: InternalAxiosRequestConfig,
): { body: unknown; status: number } {
  const key = `${method} ${path}`;

  switch (key) {
    case 'GET /health':
      // `demoMode: true` is what puts the "enter the demo" button on the
      // sign-in screen, which is the shortest route into the app when there
      // is no account to sign in with.
      return envelope({ status: 'ok', demoMode: true });

    // ── Auth ────────────────────────────────────────────────────────────
    // Any credentials are accepted. There is nothing to authenticate
    // against, and a preview that refuses to open is worse than no preview.
    case 'POST /auth/login':
    case 'POST /auth/register':
    case 'POST /auth/demo-session':
      return envelope({ user: MOCK_USER, tokens: mockTokens() });

    case 'POST /auth/refresh':
      return envelope({ tokens: mockTokens() });

    case 'POST /auth/logout':
      return envelope({ success: true });

    case 'POST /auth/change-password':
    case 'POST /auth/password-reset/request':
    case 'POST /auth/password-reset/confirm':
    case 'POST /auth/verify-phone/request':
    case 'POST /auth/verify-phone/confirm':
      return envelope({ success: true });

    case 'DELETE /users/me':
      return envelope({
        deletedAt: new Date().toISOString(),
        anonymizedAfter: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });

    // ── Wallet ──────────────────────────────────────────────────────────
    case 'GET /wallet/me':
      return envelope(state.wallet);
    case 'GET /wallet/me/ledger':
      return envelope(paged(state.ledger));
    case 'GET /wallet/me/lots':
      return envelope(state.lots);

    // ── History ─────────────────────────────────────────────────────────
    case 'GET /transactions/me':
      return envelope(paged(state.transactions));

    // ── Referrals ───────────────────────────────────────────────────────
    case 'GET /referral/me/code':
      return envelope(state.referralCode);
    case 'GET /referral/me/invites':
      return envelope(state.invites);

    // ── Notifications ───────────────────────────────────────────────────
    case 'GET /notifications/me':
      return envelope(paged(state.notifications));
    case 'POST /notifications/read-all':
      state.notifications = state.notifications.map((n) => ({ ...n, isRead: true }));
      return envelope({ success: true });
    case 'POST /notifications/push-token':
      return envelope({ success: true });

    // ── Partners ────────────────────────────────────────────────────────
    /*
     * Filtered here rather than returned wholesale.
     *
     * The temptation is to hand back all twelve and let the screen sort it
     * out — and then the chips and the search box appear to work while doing
     * nothing, because the screen was never the thing filtering. The demo's
     * job is to answer "does this screen work", so the filters have to be
     * exercised end to end, on the same query parameters the API takes.
     */
    case 'GET /partners/nearby': {
      const params = (config.params ?? {}) as {
        category?: string;
        q?: string;
        radiusKm?: number | string;
      };
      const needle = (params.q ?? '').trim().toLowerCase();
      const radiusKm = Number(params.radiusKm ?? 10);

      return envelope(
        state.partners
          .filter((p) => (params.category ? p.category === params.category : true))
          .filter((p) =>
            needle
              ? [p.name, p.branchName, p.address].some((field) =>
                  field.toLowerCase().includes(needle),
                )
              : true,
          )
          .filter((p) => p.distanceKm <= radiusKm)
          .sort((a, b) => a.distanceKm - b.distanceKm),
      );
    }

    // ── EV ──────────────────────────────────────────────────────────────
    case 'GET /ev/stations':
    case 'GET /ev/stations/nearby':
      return envelope(state.stations);
    case 'GET /ev/sessions/me':
      return envelope(state.sessions);
    case 'GET /ev/reservations/me':
      return envelope([]);

    case 'POST /ev/reservations': {
      const { connectorId } = body<{ connectorId: string }>(config);
      return envelope({
        id: `res-${Date.now()}`,
        connectorId,
        userId: MOCK_USER.id,
        status: 'CONFIRMED',
        startAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
    }

    case 'POST /ev/sessions/start': {
      const { connectorId } = body<{ connectorId: string }>(config);
      const session = {
        id: `session-${Date.now()}`,
        connectorId,
        userId: MOCK_USER.id,
        status: EvSessionStatus.CHARGING,
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        energyKwh: '0',
        cost: '0',
        bonusEarned: null,
        ocpiCdrId: null,
      };
      state.sessions = [session, ...state.sessions];
      return envelope(session);
    }

    // ── QR ──────────────────────────────────────────────────────────────
    case 'POST /qr/issue': {
      const { amount } = body<{ amount?: string }>(config);
      return envelope({
        id: `qr-${Date.now()}`,
        type: QrCodeType.USER_PAY_TOKEN,
        status: QrCodeStatus.ACTIVE,
        token: `TUTAK-DEMO-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        issuedByUserId: MOCK_USER.id,
        partnerId: null,
        amount: amount ?? null,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      });
    }

    case 'POST /qr/redeem': {
      // A fixed amount, because a scanned code carries the merchant's price
      // and there is no merchant here. The wallet moves, which is the part
      // worth seeing.
      const charged = '3200';
      const earned = '160';
      state.wallet = {
        ...state.wallet,
        availableBonus: sum(state.wallet.availableBonus, earned),
        lifetimeEarned: sum(state.wallet.lifetimeEarned, earned),
        version: state.wallet.version + 1,
        updatedAt: new Date().toISOString(),
      };
      return envelope({
        transactionId: `tx-${Date.now()}`,
        amountCharged: charged,
        bonusApplied: '0',
        bonusEarned: earned,
      });
    }

    default:
      break;
  }

  // Routes with an id in them.
  const readNotification = /^\/notifications\/([^/]+)\/read$/.exec(path);
  if (method === 'POST' && readNotification) {
    const id = readNotification[1];
    state.notifications = state.notifications.map((n) =>
      n.id === id ? { ...n, isRead: true } : n,
    );
    return envelope({ success: true });
  }

  const stopSession = /^\/ev\/sessions\/([^/]+)\/stop$/.exec(path);
  if (method === 'POST' && stopSession) {
    const id = stopSession[1];
    const existing = state.sessions.find((s) => s.id === id);
    const energy = existing?.energyKwh ?? '12';
    const cost = existing?.cost ?? '1140';
    const earned = String(Math.round(Number(cost) * 0.03 * 100) / 100);

    const stopped = {
      ...(existing ?? {
        id,
        connectorId: 'conn-2',
        userId: MOCK_USER.id,
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        ocpiCdrId: null,
      }),
      status: EvSessionStatus.COMPLETED,
      stoppedAt: new Date().toISOString(),
      energyKwh: energy,
      cost,
      bonusEarned: String(earned),
    } as MockState['sessions'][number];

    state.sessions = state.sessions.map((s) => (s.id === id ? stopped : s));
    state.wallet = {
      ...state.wallet,
      availableBonus: sum(state.wallet.availableBonus, String(earned)),
      lifetimeEarned: sum(state.wallet.lifetimeEarned, String(earned)),
      version: state.wallet.version + 1,
      updatedAt: new Date().toISOString(),
    };
    return envelope(stopped);
  }

  return {
    body: {
      statusCode: 404,
      code: 'Not Found',
      message: `No mock for ${method} ${path}. Add one in mockAdapter.ts.`,
    },
    status: 404,
  };
}

export const mockAdapter: AxiosAdapter = (config) =>
  new Promise<AxiosResponse>((resolve, reject) => {
    const method = (config.method ?? 'get').toUpperCase();
    const path = normalisePath(config as InternalAxiosRequestConfig);
    const result = handle(method, path, config as InternalAxiosRequestConfig);

    setTimeout(() => {
      const response = {
        data: result.body,
        status: result.status,
        statusText: result.status === 200 ? 'OK' : 'Not Found',
        headers: {},
        config,
      } as AxiosResponse;

      // Rejecting on a non-2xx is what axios itself does, and the app's error
      // handling is built on it. Resolving everything would make the preview
      // quietly incapable of showing an error state.
      if (result.status >= 400) {
        const error = new Error(`Request failed with status code ${result.status}`) as Error & {
          isAxiosError: boolean;
          response: AxiosResponse;
          config: unknown;
        };
        error.isAxiosError = true;
        error.response = response;
        error.config = config;
        reject(error);
        return;
      }

      resolve(response);
    }, LATENCY_MS);
  });
