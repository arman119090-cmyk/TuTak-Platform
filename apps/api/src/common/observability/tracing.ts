import { diag, DiagConsoleLogger, DiagLogLevel, trace } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

/**
 * Distributed tracing, started before anything else in the process.
 *
 * This module is imported at the very top of `main.ts`, before Nest, Prisma
 * or the HTTP server. That ordering is not stylistic: the auto
 * instrumentations work by patching modules as they are required, so any
 * module loaded before the SDK starts is never traced. A tracing setup that
 * silently covers half the application is worse than none, because it makes
 * the untraced half look like it is not being called.
 *
 * Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Unlike SMS and push,
 * production does *not* refuse to boot without it — those two are how a
 * customer receives something, and their absence is invisible to everyone
 * but the customer. Missing traces are visible to the operator the first
 * time they look, and refusing to serve payments because a telemetry
 * collector is unreachable would trade a real outage for an observability
 * gap.
 */
let sdk: NodeSDK | null = null;

export interface TracingConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  endpoint: string;
  /** Extra headers for the collector, e.g. an API key. `k=v,k=v`. */
  headers: string;
  debug: boolean;
}

function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    headers[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return headers;
}

export function startTracing(config: TracingConfig): boolean {
  if (!config.endpoint) return false;
  if (sdk) return true;

  if (config.debug) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      'deployment.environment.name': config.environment,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${config.endpoint.replace(/\/$/, '')}/v1/traces`,
      headers: parseHeaders(config.headers),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Health probes fire every few seconds forever. Tracing them buries
        // real requests in noise and costs money at every collector that
        // charges by span.
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) => {
            const url = request.url ?? '';
            return url.startsWith('/health') || url === '/favicon.ico';
          },
        },
        // Reads every file the process touches at startup. Never worth it.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  return true;
}

/**
 * Flushes pending spans on the way down.
 *
 * Without this the spans describing whatever was in flight when the process
 * was told to stop are lost — which is exactly the window an operator is
 * looking at after a crash or a rolling deploy.
 */
export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown().catch(() => undefined);
  sdk = null;
}

/**
 * The active trace id, for stitching a log line to the trace it belongs to.
 *
 * Returns null when tracing is off, which is the common case locally —
 * callers must treat it as optional rather than assuming a trace exists.
 */
export function activeTraceId(): string | null {
  const span = trace.getActiveSpan();
  if (!span) return null;
  const { traceId } = span.spanContext();
  // All-zero is OpenTelemetry's invalid trace id; emitting it as if it were
  // real sends an operator looking for a trace that was never recorded.
  return traceId && traceId !== '00000000000000000000000000000000' ? traceId : null;
}
