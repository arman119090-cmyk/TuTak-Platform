import 'reflect-metadata';
// Before every other import. The OpenTelemetry auto instrumentations work by
// patching modules as they are required, so anything loaded before the SDK
// starts is never traced — and half-traced is worse than untraced, because
// the untraced half looks like it is never called.
import { startTracing, stopTracing } from './common/observability/tracing';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { StructuredLogger } from './common/observability/structured-logger';

const tracingEnabled = startTracing({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'tutak-api',
  serviceVersion: process.env.npm_package_version ?? '0.1.0',
  environment: process.env.NODE_ENV ?? 'development',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
  headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ?? '',
  debug: process.env.OTEL_DEBUG === 'true',
});

async function bootstrap() {
  // `bufferLogs` holds startup output until the real logger is installed, so
  // the first lines of a production boot are JSON like every line after them
  // rather than a format nothing downstream can parse.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
    bufferLogs: true,
  });
  const config = app.get(ConfigService<AppConfig, true>);

  const nodeEnv = config.get('nodeEnv', { infer: true });
  const isProduction = nodeEnv === 'production';
  // `staging` (docs/DEPLOYMENT.md §1) is a real deployment reachable over
  // the network, not a developer's own machine — it needs the same
  // network-facing hardening `production` needs (CORS enforcement, Swagger
  // off) even though it is deliberately exempt from the *commercial*
  // boot guards (SmsModule/PushModule/PaymentsModule/RedisModule), which
  // stay keyed to `production` alone since staging legitimately has no
  // live carrier or acquirer.
  const isPublicFacing = isProduction || nodeEnv === 'staging';
  app.useLogger(new StructuredLogger(isProduction));

  app.use(helmet());
  app.use(compression());
  // Required to read the httpOnly refresh cookie the web clients now use.
  app.use(cookieParser());

  // Reflecting any origin while sending credentials is a misconfiguration, and
  // CORS_ORIGINS is not required by env validation — so a deployment that
  // forgot it used to become fully permissive in silence (§M5).
  const origins = config.get('cors.origins', { infer: true });
  if (isPublicFacing && origins.length === 0) {
    throw new Error('CORS_ORIGINS must list the allowed origins outside development');
  }
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
  });

  // Behind an ingress every request shares the proxy's address, which turns
  // the per-IP throttler into one platform-wide bucket and records the proxy
  // in every audit row (§M6).
  app.set('trust proxy', 1);

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (!isPublicFacing) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('TuTak API')
      .setDescription('TuTak loyalty ecosystem — backend API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  // Spans describing whatever was in flight when the process is told to stop
  // are exactly the ones an operator wants after a crash or a rolling
  // deploy, and they are the ones lost without an explicit flush.
  app.enableShutdownHooks();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void stopTracing().finally(() => process.exit(0));
    });
  }

  const port = config.get('port', { infer: true });
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(
    `TuTak API listening on port ${port}` +
      (tracingEnabled ? ' (tracing on)' : ''),
  );

  // Loud on purpose, and at the end so it is the last thing in the log
  // rather than buried under Nest's route table. Somebody reading these logs
  // to work out why a payment never reached the bank should not have to
  // discover the acquirer was fake — it should be the first thing they see.
  if (config.get('demoMode', { infer: true })) {
    /* eslint-disable no-console */
    console.log('');
    console.log('  ╔════════════════════════════════════════════════════════════╗');
    console.log('  ║  DEMO MODE — no real money can move through this instance  ║');
    console.log('  ╠════════════════════════════════════════════════════════════╣');
    console.log('  ║  Payments run on the sandbox acquirer: every charge is      ║');
    console.log('  ║  simulated and nothing reaches a bank.                      ║');
    console.log('  ║  SMS codes are written to this log, not delivered.          ║');
    console.log('  ║                                                            ║');
    console.log('  ║  Every other protection is on: CORS allowlist, security     ║');
    console.log('  ║  headers, rate limits, secret validation.                   ║');
    console.log('  ║                                                            ║');
    console.log('  ║  Unset DEMO_MODE before this becomes a real deployment.     ║');
    console.log('  ╚════════════════════════════════════════════════════════════╝');
    console.log('');
    /* eslint-enable no-console */
  }
}

// `void` is the explicit acknowledgement that nothing awaits the top-level
// bootstrap; without it a rejection here would be an unhandled promise and
// the process would exit with no diagnostic.
void bootstrap();
