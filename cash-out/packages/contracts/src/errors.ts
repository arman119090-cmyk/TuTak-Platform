/**
 * Stable, machine-readable error codes.
 *
 * The mobile app switches on these, not on message text, and the messages
 * themselves live in `@cashout/i18n` so that a driver sees an explanation in
 * their own language rather than an English stack trace.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_TOO_MANY_ATTEMPTS',
  'OTP_REQUEST_TOO_SOON',
  'PHONE_NOT_LINKED_TO_DRIVER',
  'DRIVER_NOT_VERIFIED',
  'DRIVER_BLOCKED',
  'PAYOUT_METHOD_NOT_FOUND',
  'PAYOUT_METHOD_NOT_VERIFIED',
  'INSUFFICIENT_BALANCE',
  'AMOUNT_BELOW_MINIMUM',
  'AMOUNT_ABOVE_MAXIMUM',
  'AMOUNT_DOES_NOT_COVER_FEES',
  'DAILY_LIMIT_EXCEEDED',
  'WEEKLY_LIMIT_EXCEEDED',
  'MONTHLY_LIMIT_EXCEEDED',
  'VELOCITY_LIMIT_EXCEEDED',
  'WITHDRAWAL_ALREADY_IN_PROGRESS',
  'QUOTE_EXPIRED',
  'QUOTE_MISMATCH',
  'BALANCE_CHANGED',
  'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
  'UNDER_MANUAL_REVIEW',
  'YANDEX_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  readonly code: ErrorCode;
  /** Developer-facing text. Never shown to a driver verbatim. */
  readonly message: string;
  /** Correlates a client report with server logs. */
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
