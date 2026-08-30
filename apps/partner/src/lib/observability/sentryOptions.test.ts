import { buildSentryOptions } from './sentryOptions';

describe('buildSentryOptions (partner)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('disables tracing and PII by default, and tags the service as partner', () => {
    const options = buildSentryOptions();

    expect(options.tracesSampleRate).toBe(0);
    expect(options.sendDefaultPii).toBe(false);
    expect((options.initialScope as { tags: Record<string, string> }).tags.service).toBe('partner');
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

  it('drops extra entirely through the configured beforeSend, rather than merely scrubbing it', () => {
    const options = buildSentryOptions();
    const beforeSend = options.beforeSend as unknown as (
      event: Record<string, unknown>,
    ) => Record<string, unknown>;

    const result = beforeSend({ extra: { authorization: 'Bearer xyz' } });

    expect(result.extra).toBeUndefined();
  });

  it('scrubs a secret embedded in an exception message, with no sensitive key involved', () => {
    const options = buildSentryOptions();
    const beforeSend = options.beforeSend as unknown as (
      event: Record<string, unknown>,
    ) => Record<string, unknown>;

    const result = beforeSend({
      exception: { values: [{ type: 'Error', value: 'Authorization: Bearer secret-token-abc' }] },
    });

    expect(JSON.stringify(result)).not.toContain('secret-token-abc');
  });

  it('drops breadcrumb data entirely through the configured beforeBreadcrumb', () => {
    const options = buildSentryOptions();
    const beforeBreadcrumb = options.beforeBreadcrumb as unknown as (
      breadcrumb: Record<string, unknown>,
    ) => Record<string, unknown>;

    const result = beforeBreadcrumb({ data: { url: 'https://x/y?token=abc', body: 'secret-payload' } });

    expect(result.data).toBeUndefined();
  });
});
