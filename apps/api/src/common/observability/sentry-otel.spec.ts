/**
 * Real (unmocked) proof that `initSentry()`'s `skipOpenTelemetrySetup: true`
 * does what it claims against the actual SDKs, not against a stub that only
 * proves we called the right function with the right flag.
 *
 * Uses this API's own `startTracing()`/`stopTracing()` (tracing.ts) — the
 * exact module `main.ts` calls before `initSentry()` — so this exercises the
 * real coexistence path, not a hand-rolled substitute.
 */
import { trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/node';
import { activeTraceId, startTracing, stopTracing } from './tracing';
import { initSentry } from './sentry';

function fakeTransport(): NonNullable<Parameters<typeof Sentry.init>[0]>['transport'] {
  return () => ({
    send: () => Promise.resolve({}),
    flush: () => Promise.resolve(true),
  });
}

function capturingTransport(sink: unknown[]): NonNullable<Parameters<typeof Sentry.init>[0]>['transport'] {
  return () => ({
    send: (envelope: unknown) => {
      sink.push(envelope);
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  });
}

describe('Sentry + OpenTelemetry coexistence (real SDKs, no mocks)', () => {
  const originalDsn = process.env.SENTRY_DSN;

  afterEach(async () => {
    await Sentry.close(200).catch(() => undefined);
    await stopTracing();
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it('leaves Sentry tracing disabled', () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/1';
    initSentry({ transport: fakeTransport() });

    expect(Sentry.getClient()?.getOptions().tracesSampleRate).toBe(0);
  });

  it('never sets up its own OpenTelemetry tracer provider on top of the one apps/api already installed', () => {
    const started = startTracing({
      serviceName: 'tutak-api-test',
      serviceVersion: '0.0.0-test',
      environment: 'test',
      // Never actually reached: this test creates no spans, so nothing is
      // ever exported and no network call is made against this address.
      endpoint: 'http://127.0.0.1:4318',
      headers: '',
      debug: false,
    });
    expect(started).toBe(true);
    const providerAfterTracing = trace.getTracerProvider();

    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/1';
    initSentry({ transport: fakeTransport() });

    // `skipOpenTelemetrySetup: true` means Sentry's own `initOpenTelemetry()`
    // is never called, so the global tracer provider apps/api's own
    // tracing.ts registered is still the one every module resolves to.
    expect(trace.getTracerProvider()).toBe(providerAfterTracing);
    // `initOpenTelemetry()` is also what sets `client.traceProvider` — its
    // absence is direct proof Sentry never built its own pipeline at all,
    // not just that the global registration was left alone.
    expect((Sentry.getClient() as unknown as { traceProvider?: unknown })?.traceProvider).toBeUndefined();
  });

  it('still captures an exception end to end with the coexistence option set', async () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/1';
    const sent: unknown[] = [];
    initSentry({ transport: capturingTransport(sent) });

    Sentry.withScope((scope) => {
      scope.setTag('service', 'api');
      Sentry.captureException(new Error('otel-coexistence-smoke-test'));
    });
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(sent)).toContain('otel-coexistence-smoke-test');
  });

  it('leaves apps/api\'s own OpenTelemetry tracing fully functional once Sentry has initialized alongside it', async () => {
    startTracing({
      serviceName: 'tutak-api-test',
      serviceVersion: '0.0.0-test',
      environment: 'test',
      endpoint: 'http://127.0.0.1:4318',
      headers: '',
      debug: false,
    });

    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/1';
    initSentry({ transport: fakeTransport() });

    const tracer = trace.getTracer('tutak-api-test');
    let idWhileActive: string | null = null;
    await tracer.startActiveSpan('test-span', (span) => {
      idWhileActive = activeTraceId();
      span.end();
      return Promise.resolve();
    });

    expect(idWhileActive).not.toBeNull();
    expect(idWhileActive).not.toBe('00000000000000000000000000000000');
  });
});
