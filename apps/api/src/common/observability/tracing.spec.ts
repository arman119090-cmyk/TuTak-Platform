import { activeTraceId, startTracing, stopTracing } from './tracing';

/**
 * Tracing setup.
 *
 * Two behaviours are worth pinning: it stays completely out of the way when
 * no collector is configured — which is every local run and every test — and
 * `activeTraceId` never hands the logger something that looks like a trace
 * id but is not, because an operator following that into a trace viewer
 * finds nothing and concludes the trace was dropped.
 */
describe('tracing', () => {
  const base = {
    serviceName: 'tutak-api-test',
    serviceVersion: '0.0.0',
    environment: 'test',
    headers: '',
    debug: false,
  };

  afterEach(async () => {
    await stopTracing();
  });

  it('does nothing when no collector endpoint is configured', () => {
    // The common case. Starting an exporter that points nowhere would retry
    // against localhost forever and fill the log with connection errors.
    expect(startTracing({ ...base, endpoint: '' })).toBe(false);
  });

  it('reports null rather than an invalid trace id when tracing is off', () => {
    // OpenTelemetry's no-op span carries an all-zero trace id. Writing that
    // into a log line sends someone looking for a trace that was never
    // recorded.
    expect(activeTraceId()).toBeNull();
  });

  it('starts once and stays started when asked twice', () => {
    expect(startTracing({ ...base, endpoint: 'http://collector.invalid:4318' })).toBe(true);
    // A second call must not build a second SDK — two exporters would double
    // every span and neither would own shutdown.
    expect(startTracing({ ...base, endpoint: 'http://collector.invalid:4318' })).toBe(true);
  });

  it('shuts down without throwing even if the collector was never reachable', async () => {
    startTracing({ ...base, endpoint: 'http://collector.invalid:4318' });
    // Shutdown runs on SIGTERM. Throwing there would turn a clean stop into
    // a crash, which is a worse outcome than losing a few spans.
    await expect(stopTracing()).resolves.toBeUndefined();
  });

  it('is safe to shut down when it was never started', async () => {
    await expect(stopTracing()).resolves.toBeUndefined();
  });
});
