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
  /** The phone number is in no park's roster. */
  'DRIVER_NOT_FOUND',
  'DRIVER_NOT_VERIFIED',
  'DRIVER_BLOCKED',
  /** The driver asked for a park they hold no eligible membership in. */
  'PARK_ACCESS_DENIED',
  /** No active park is selected yet. */
  'PARK_NOT_SELECTED',
  /** The balance could not be read at all. */
  'BALANCE_UNAVAILABLE',
  /** Only a cached figure is available and the operation needs a fresh one. */
  'BALANCE_STALE',
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
  'IDRAM_UNAVAILABLE',
  'IDRAM_ACCOUNT_NOT_LINKED',
  'IDRAM_ACCOUNT_REJECTED',
  /** A withdrawal that has not finished yet; the client should keep polling. */
  'PAYOUT_PROCESSING',
  'PAYOUT_REJECTED',
  'PAYOUT_UNCERTAIN',
  /** A money operation was attempted without a PIN/biometric authorization. */
  'AUTHORIZATION_REQUIRED',
  'AUTHORIZATION_INVALID',
  'PIN_NOT_SET',
  'PIN_INVALID',
  'PIN_LOCKED',
  'PIN_ALREADY_SET',
  'BIOMETRIC_NOT_ENROLLED',
  'DRIVER_ID_CHANGE_PENDING',
  'DRIVER_ID_INVALID',
  'AUTO_PAYOUT_INVALID',
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
