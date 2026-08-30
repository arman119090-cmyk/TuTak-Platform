/**
 * @jest-environment node
 */
// Route handlers run in the Node (or Edge) runtime in production, never
// jsdom — jsdom's environment does not provide the global `Response` this
// route constructs, so this suite opts back into the real runtime.

const mockWithScope = jest.fn((cb: (scope: { setTag: jest.Mock }) => void) => cb({ setTag: jest.fn() }));
const mockCaptureException = jest.fn();
const mockFlush = jest.fn();
jest.mock('@sentry/nextjs', () => ({
  withScope: (cb: (scope: unknown) => void) => mockWithScope(cb),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  flush: (...args: unknown[]) => mockFlush(...args),
}));

import { POST } from './route';
import { VERIFY_TOKEN_HEADER } from '@/lib/observability/sentryVerifyGate';

const TOKEN = 'staging-verify-token-for-tests';

// `NODE_ENV` is typed readonly on `process.env`; the gate no longer reads it,
// but these tests set it to `production` anyway — the point of the fix is
// that a production-mode build with staging runtime values still works.
const env = process.env as Record<string, string | undefined>;

function post(headers: Record<string, string> = {}): Promise<Response> {
  return POST(new Request('http://localhost/api/internal/sentry-verify', { method: 'POST', headers }));
}

function withToken(token = TOKEN) {
  return { [VERIFY_TOKEN_HEADER]: token };
}

describe('POST /api/internal/sentry-verify (admin)', () => {
  const original = { ...process.env };

  beforeEach(() => {
    // The shape a correctly configured staging box has: built in production
    // mode, told at runtime that it is staging.
    env.NODE_ENV = 'production';
    env.APP_ENV = 'staging';
    env.SENTRY_VERIFY_ENABLED = 'true';
    env.SENTRY_VERIFY_TOKEN = TOKEN;
    mockWithScope.mockClear();
    mockCaptureException.mockClear();
    mockFlush.mockClear();
    mockFlush.mockResolvedValue(true);
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete env[key];
    Object.assign(process.env, original);
  });

  it('fires the probe when the environment is staging and the token matches — even though the build is production-mode', async () => {
    const response = await post(withToken());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect((mockCaptureException.mock.calls[0]![0] as Error).name).toBe('SentryVerificationProbe');
  });

  it.each(['development', 'preview', 'staging'])('allows the %s environment', async (appEnv) => {
    env.APP_ENV = appEnv;

    expect((await post(withToken())).status).toBe(200);
  });

  it('sends nothing but service and kind tags', async () => {
    const setTag = jest.fn();
    mockWithScope.mockImplementationOnce((cb) => cb({ setTag }));

    await post(withToken());

    expect(setTag.mock.calls).toEqual([
      ['service', 'admin'],
      ['kind', 'sentry-verify'],
    ]);
  });

  describe('every denied case returns the same 404 and captures nothing', () => {
    async function expectDenied() {
      const response = await post(withToken());
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('');
      expect(mockCaptureException).not.toHaveBeenCalled();
      expect(mockWithScope).not.toHaveBeenCalled();
      expect(mockFlush).not.toHaveBeenCalled();
    }

    it('production APP_ENV', async () => {
      env.APP_ENV = 'production';
      await expectDenied();
    });

    it('unset APP_ENV', async () => {
      delete env.APP_ENV;
      await expectDenied();
    });

    it('an APP_ENV nobody allowlisted', async () => {
      env.APP_ENV = 'prod-eu';
      await expectDenied();
    });

    it('the enable flag is missing', async () => {
      delete env.SENTRY_VERIFY_ENABLED;
      await expectDenied();
    });

    it('the enable flag is not exactly "true"', async () => {
      env.SENTRY_VERIFY_ENABLED = 'TRUE';
      await expectDenied();
    });

    it('no token is configured on the server', async () => {
      delete env.SENTRY_VERIFY_TOKEN;
      await expectDenied();
    });

    it('the request supplies no token', async () => {
      const response = await post();
      expect(response.status).toBe(404);
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('the request supplies the wrong token', async () => {
      const response = await post(withToken('not-the-configured-token'));
      expect(response.status).toBe(404);
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('the request supplies a token that is a prefix of the real one', async () => {
      const response = await post(withToken(TOKEN.slice(0, -1)));
      expect(response.status).toBe(404);
      expect(mockCaptureException).not.toHaveBeenCalled();
    });
  });

  it('tells every layer not to cache either answer', async () => {
    const allowed = await post(withToken());
    env.APP_ENV = 'production';
    const denied = await post(withToken());

    for (const response of [allowed, denied]) {
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });

  it('never echoes the supplied token back', async () => {
    env.APP_ENV = 'production';
    const response = await post(withToken());

    const body = await response.text();
    expect(body).not.toContain(TOKEN);
    expect(JSON.stringify([...response.headers])).not.toContain(TOKEN);
  });
});
