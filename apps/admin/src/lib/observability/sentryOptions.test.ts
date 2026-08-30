import { buildSentryOptions } from './sentryOptions';

describe('buildSentryOptions (admin)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('disables tracing and PII by default, and tags the service as admin', () => {
    const options = buildSentryOptions();

    expect(options.tracesSampleRate).toBe(0);
    expect(options.sendDefaultPii).toBe(false);
    expect((options.initialScope as { tags: Record<string, string> }).tags.service).toBe('admin');
  });

  it('reads dsn, environment and release from their configured env vars', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://example@o0.ingest.sentry.io/1';
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = 'staging';
    process.env.NEXT_PUBLIC_SENTRY_RELEASE = 'abc1234';

    const options = buildSentryOptions();

    expect(options.dsn).toBe('https://example@o0.ingest.sentry.io/1');
    expect(options.environment).toBe('staging');
    expect(options.release).toBe('abc1234');
  });

  it('has the strict allowlist policy wired into beforeSend', () => {
    const options = buildSentryOptions();
    const beforeSend = options.beforeSend as unknown as (
      event: Record<string, unknown>,
    ) => Record<string, unknown>;

    const result = beforeSend({
      message: 'password hunter2 for Арман',
      request: { url: '/v1/users/Арман' },
      user: { email: 'a@b.com' },
      extra: { opaque: 'Zx9QpLm2Vt7RhK4NsE1BgYcW' },
      contexts: { custom: { ssn: '123-45-6789' } },
      fingerprint: ['Арман Петросян'],
      tags: { service: 'admin', customerName: 'Арман Петросян' },
      exception: { values: [{ type: 'Error', value: 'password hunter2' }] },
    });

    expect(result.message).toBeUndefined();
    expect(result.request).toBeUndefined();
    expect(result.user).toBeUndefined();
    expect(result.extra).toBeUndefined();
    expect(result.contexts).toBeUndefined();
    expect(result.fingerprint).toBeUndefined();
    expect(result.tags).toEqual({ service: 'admin' });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('Арман');
    expect(serialized).not.toContain('a@b.com');
    expect(serialized).not.toContain('Zx9QpLm2Vt7RhK4NsE1BgYcW');
    expect(serialized).not.toContain('customerName');
  });

  it('has the strict allowlist policy wired into beforeBreadcrumb', () => {
    const options = buildSentryOptions();
    const beforeBreadcrumb = options.beforeBreadcrumb as unknown as (
      breadcrumb: Record<string, unknown>,
    ) => Record<string, unknown>;

    const result = beforeBreadcrumb({
      category: 'xhr',
      message: 'GET /v1/users/Арман',
      data: { url: 'https://x/y?token=abc', body: 'secret-payload' },
    });

    expect(result).toEqual({ category: 'xhr' });
  });
});
