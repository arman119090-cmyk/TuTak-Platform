import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';
import { AppLogger } from './common/logging/logger.service';
import { ENV, Env, EnvValidationError, loadEnv } from './config/env';

/**
 * `BigInt` has no JSON representation, and every monetary value in this system
 * is a BigInt. Serialising one as a string is the only lossless option — a
 * Number would silently truncate above 2^53, which for AMD minor units is a
 * balance an active park could plausibly reach.
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // Before the logger exists, and deliberately loud.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.create(AppModule.register({ env }), {
    bufferLogs: true,
    rawBody: true,
  });

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '256kb' }));
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    credentials: true,
    maxAge: 600,
  });
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');

  logger.info('Cash Out API started', {
    port: env.PORT,
    deployment: env.DEPLOYMENT_ENV,
    yandexMode: env.YANDEX_MODE,
    providerMode: env.PROVIDER_MODE,
  });

  if (env.YANDEX_MODE === 'mock' || env.PROVIDER_MODE === 'mock') {
    logger.warning(
      'Running with mock integrations — no real balance is changed and no real money moves',
      { yandexMode: env.YANDEX_MODE, providerMode: env.PROVIDER_MODE },
    );
  }
}

void bootstrap();

export { ENV };
