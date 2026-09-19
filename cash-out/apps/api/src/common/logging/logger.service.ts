import { Inject, Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import pino, { Logger } from 'pino';
import { ENV, Env } from '../../config/env';
import { requestContext } from '../request-context';

/**
 * Structured JSON logging with a redaction list.
 *
 * The redaction list is not decoration. A payout request carries a provider
 * token, an OTP verification carries a code, and an admin login carries a
 * password; logging any of them once puts it in a log aggregator forever.
 */
const REDACTED = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'code',
  'otp',
  'providerToken',
  'providerTokenEnc',
  'refreshToken',
  'accessToken',
  'signature',
  'mfaSecret',
  'mfaSecretEnc',
  'accountIdentifier',
  '*.password',
  '*.providerToken',
  '*.refreshToken',
  '*.code',
];

@Injectable()
export class AppLogger implements NestLoggerService {
  private readonly logger: Logger;

  constructor(@Inject(ENV) env: Env) {
    this.logger = pino({
      level: env.LOG_LEVEL,
      redact: { paths: REDACTED, censor: '[redacted]' },
      base: { env: env.DEPLOYMENT_ENV, service: 'cashout-api' },
      formatters: { level: (label) => ({ level: label }) },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  private enrich(payload: Record<string, unknown> = {}): Record<string, unknown> {
    const context = requestContext.get();
    return context
      ? {
          ...payload,
          requestId: context.requestId,
          userId: context.userId,
          driverId: context.driverId,
          adminUserId: context.adminUserId,
        }
      : payload;
  }

  log(message: unknown, context?: string): void {
    this.logger.info(this.enrich({ context }), String(message));
  }

  info(message: string, payload?: Record<string, unknown>): void {
    this.logger.info(this.enrich(payload), message);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.logger.error(this.enrich({ context, stack }), String(message));
  }

  fail(message: string, error: unknown, payload?: Record<string, unknown>): void {
    this.logger.error(
      this.enrich({
        ...payload,
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
        stack: error instanceof Error ? error.stack : undefined,
      }),
      message,
    );
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn(this.enrich({ context }), String(message));
  }

  warning(message: string, payload?: Record<string, unknown>): void {
    this.logger.warn(this.enrich(payload), message);
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug(this.enrich({ context }), String(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace(this.enrich({ context }), String(message));
  }
}
