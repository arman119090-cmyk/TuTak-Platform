const scopeMock = { setTag: jest.fn() };
const withScopeMock = jest.fn((cb: (scope: typeof scopeMock) => void) => cb(scopeMock));
const captureExceptionMock = jest.fn();
const initMock = jest.fn();

jest.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => initMock(...args),
  withScope: (cb: (scope: typeof scopeMock) => void) => withScopeMock(cb),
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  flush: jest.fn().mockResolvedValue(true),
  close: jest.fn().mockResolvedValue(true),
}));

import { captureApiException, initSentry, normalizeRoute, UNMATCHED_ROUTE } from './sentry';

describe('initSentry', () => {
  const originalDsn = process.env.SENTRY_DSN;
  const originalAppEnv = process.env.APP_ENV;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    initMock.mockClear();
  });

  /**
   * Which deployment an event came from — the question `APP_ENV` exists to
   * answer and `NODE_ENV` cannot.
   *
   * `app-environment.ts` says it in its own docblock: `NODE_ENV` is
   * `production` for anything deployed, always, and `APP_ENV` names *which*
   * deployment it is. Sentry was reading `NODE_ENV` anyway, so a staging
   * deployment — which on Railway also runs with `NODE_ENV=production` —
   * filed its errors under `production`. Two deployments in one bucket is
   * worse than no bucket: an alert on "production error rate" fires for a
   * staging smoke test, and the one that matters gets tuned out.
   */
  it('reports the deployment it is, not the mode Node is in', () => {
    process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/1';
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'staging';

    initSentry();

    expect((initMock.mock.calls[0]![0] as Record<string, unknown>).environment).toBe('staging');
  });

  it('falls back to NODE_ENV where APP_ENV has not been set yet', () => {
    process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/1';
    process.env.NODE_ENV = 'production';
    delete process.env.APP_ENV;

    initSentry();

    expect((initMock.mock.calls[0]![0] as Record<string, unknown>).environment).toBe('production');
  });

  it('does nothing and returns false when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;
    expect(initSentry()).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('initializes with tracing disabled and PII collection off when a DSN is present', () => {
    process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/1';
    expect(initSentry()).toBe(true);
    expect(initMock).toHaveBeenCalledTimes(1);
    const options = initMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.tracesSampleRate).toBe(0);
    // The option that stops Sentry from installing its own OpenTelemetry
    // tracer provider/context manager/propagator/sampler on top of
    // tracing.ts's — see sentry-otel.spec.ts for proof against the real SDKs.
    expect(options.skipOpenTelemetrySetup).toBe(true);
    expect(options.sendDefaultPii).toBe(false);
    expect((options.initialScope as { tags: Record<string, string> }).tags.service).toBe('api');
    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');
  });
});

describe('normalizeRoute', () => {
  it('joins baseUrl and the matched route pattern, without a query string', () => {
    const request = { baseUrl: '/v1/users', route: { path: '/:id' }, path: '/v1/users/abc' };
    expect(normalizeRoute(request as never)).toBe('/v1/users/:id');
  });

  it('reports an unmatched route rather than the raw path the caller asked for', () => {
    const request = { baseUrl: '', route: undefined, path: '/v1/users/Арман' };
    expect(normalizeRoute(request as never)).toBe(UNMATCHED_ROUTE);
  });

  it('never lets a concrete path segment reach the route tag', () => {
    // A 404 on a URL carrying a customer's name or an account number is the
    // realistic case; the status code is the diagnostic, the URL is not.
    for (const path of ['/v1/users/Арман', '/v1/customers/123456789']) {
      expect(normalizeRoute({ baseUrl: '', route: undefined, path } as never)).toBe(UNMATCHED_ROUTE);
    }
  });
});

describe('captureApiException', () => {
  beforeEach(() => {
    withScopeMock.mockClear();
    scopeMock.setTag.mockClear();
    captureExceptionMock.mockClear();
  });

  it('tags method, route and status, and captures the exception exactly once', () => {
    const error = new Error('boom');
    captureApiException(error, { method: 'GET', route: '/v1/users/:id', status: 500 });

    expect(withScopeMock).toHaveBeenCalledTimes(1);
    expect(scopeMock.setTag).toHaveBeenCalledWith('http.method', 'GET');
    expect(scopeMock.setTag).toHaveBeenCalledWith('http.route', '/v1/users/:id');
    expect(scopeMock.setTag).toHaveBeenCalledWith('http.status_code', 500);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(error);
  });
});
