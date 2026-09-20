import { Module } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { AppLogger } from '../../common/logging/logger.service';
import { Clock } from '../../common/clock';
import { YandexFleetPort } from './yandex.port';
import { YandexHttpAdapter } from './yandex-http.adapter';
import { YandexMockAdapter } from './yandex-mock.adapter';
import { YandexCredentialsResolver } from './yandex-credentials.service';

/**
 * Which Yandex the process talks to is decided once, here, from validated
 * configuration — never by an `if` inside a service. A service that could choose
 * between the real API and a fake at call time is a service that can be talked
 * into choosing wrong.
 */
@Module({
  providers: [
    YandexMockAdapter,
    YandexCredentialsResolver,
    {
      provide: YandexFleetPort,
      inject: [ENV, AppLogger, Clock, YandexCredentialsResolver, YandexMockAdapter],
      useFactory: (
        env: Env,
        logger: AppLogger,
        clock: Clock,
        credentials: YandexCredentialsResolver,
        mock: YandexMockAdapter,
      ) =>
        env.YANDEX_MODE === 'live' ? new YandexHttpAdapter(env, logger, clock, credentials) : mock,
    },
  ],
  exports: [YandexFleetPort, YandexMockAdapter, YandexCredentialsResolver],
})
export class YandexModule {}
