import 'reflect-metadata';
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

async function bootstrap() {
  // `bufferLogs` holds startup output until the real logger is installed, so
  // the first lines of a production boot are JSON like every line after them
  // rather than a format nothing downstream can parse.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
    bufferLogs: true,
  });
  const config = app.get(ConfigService<AppConfig, true>);

  const isProduction = config.get('nodeEnv', { infer: true }) === 'production';
  app.useLogger(new StructuredLogger(isProduction));

  app.use(helmet());
  app.use(compression());
  // Required to read the httpOnly refresh cookie the web clients now use.
  app.use(cookieParser());

  // Reflecting any origin while sending credentials is a misconfiguration, and
  // CORS_ORIGINS is not required by env validation — so a production deploy
  // that forgot it used to become fully permissive in silence (§M5).
  const origins = config.get('cors.origins', { infer: true });
  if (config.get('nodeEnv', { infer: true }) === 'production' && origins.length === 0) {
    throw new Error('CORS_ORIGINS must list the allowed origins in production');
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

  if (config.get('nodeEnv', { infer: true }) !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('TuTak API')
      .setDescription('TuTak loyalty ecosystem — backend API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('port', { infer: true });
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`TuTak API listening on port ${port}`);
}

// `void` is the explicit acknowledgement that nothing awaits the top-level
// bootstrap; without it a rejection here would be an unhandled promise and
// the process would exit with no diagnostic.
void bootstrap();
