import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@cashout/contracts';

const STATUS_BY_CODE: Readonly<Record<ErrorCode, HttpStatus>> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  TOKEN_EXPIRED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  OTP_INVALID: HttpStatus.BAD_REQUEST,
  OTP_EXPIRED: HttpStatus.BAD_REQUEST,
  OTP_TOO_MANY_ATTEMPTS: HttpStatus.TOO_MANY_REQUESTS,
  OTP_REQUEST_TOO_SOON: HttpStatus.TOO_MANY_REQUESTS,
  PHONE_NOT_LINKED_TO_DRIVER: HttpStatus.CONFLICT,
  DRIVER_NOT_FOUND: HttpStatus.CONFLICT,
  DRIVER_NOT_VERIFIED: HttpStatus.CONFLICT,
  DRIVER_BLOCKED: HttpStatus.FORBIDDEN,
  PARK_ACCESS_DENIED: HttpStatus.FORBIDDEN,
  PARK_NOT_SELECTED: HttpStatus.CONFLICT,
  BALANCE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  BALANCE_STALE: HttpStatus.CONFLICT,
  PAYOUT_METHOD_NOT_FOUND: HttpStatus.NOT_FOUND,
  PAYOUT_METHOD_NOT_VERIFIED: HttpStatus.CONFLICT,
  INSUFFICIENT_BALANCE: HttpStatus.CONFLICT,
  AMOUNT_BELOW_MINIMUM: HttpStatus.BAD_REQUEST,
  AMOUNT_ABOVE_MAXIMUM: HttpStatus.BAD_REQUEST,
  AMOUNT_DOES_NOT_COVER_FEES: HttpStatus.BAD_REQUEST,
  DAILY_LIMIT_EXCEEDED: HttpStatus.CONFLICT,
  WEEKLY_LIMIT_EXCEEDED: HttpStatus.CONFLICT,
  MONTHLY_LIMIT_EXCEEDED: HttpStatus.CONFLICT,
  VELOCITY_LIMIT_EXCEEDED: HttpStatus.TOO_MANY_REQUESTS,
  WITHDRAWAL_ALREADY_IN_PROGRESS: HttpStatus.CONFLICT,
  QUOTE_EXPIRED: HttpStatus.CONFLICT,
  QUOTE_MISMATCH: HttpStatus.CONFLICT,
  BALANCE_CHANGED: HttpStatus.CONFLICT,
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD: HttpStatus.CONFLICT,
  UNDER_MANUAL_REVIEW: HttpStatus.CONFLICT,
  YANDEX_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  IDRAM_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  IDRAM_ACCOUNT_NOT_LINKED: HttpStatus.CONFLICT,
  IDRAM_ACCOUNT_REJECTED: HttpStatus.CONFLICT,
  PAYOUT_PROCESSING: HttpStatus.CONFLICT,
  PAYOUT_REJECTED: HttpStatus.CONFLICT,
  PAYOUT_UNCERTAIN: HttpStatus.CONFLICT,
  AUTHORIZATION_REQUIRED: HttpStatus.FORBIDDEN,
  AUTHORIZATION_INVALID: HttpStatus.FORBIDDEN,
  PIN_NOT_SET: HttpStatus.CONFLICT,
  PIN_INVALID: HttpStatus.FORBIDDEN,
  PIN_LOCKED: HttpStatus.TOO_MANY_REQUESTS,
  PIN_ALREADY_SET: HttpStatus.CONFLICT,
  BIOMETRIC_NOT_ENROLLED: HttpStatus.CONFLICT,
  DRIVER_ID_CHANGE_PENDING: HttpStatus.CONFLICT,
  DRIVER_ID_INVALID: HttpStatus.CONFLICT,
  AUTO_PAYOUT_INVALID: HttpStatus.BAD_REQUEST,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * The only exception type the API throws deliberately.
 *
 * The HTTP status is derived from the error code, so a code cannot accidentally
 * be returned as a 200 in one controller and a 400 in another, and the client
 * only ever switches on `code`.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, STATUS_BY_CODE[code]);
    this.name = 'AppError';
  }

  static notFound(what: string): AppError {
    return new AppError('NOT_FOUND', `${what} not found`);
  }

  static forbidden(why = 'Not allowed'): AppError {
    return new AppError('FORBIDDEN', why);
  }
}

export function statusForCode(code: ErrorCode): HttpStatus {
  return STATUS_BY_CODE[code];
}
