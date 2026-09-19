import { isSerializationFailure } from './prisma.service';

export interface RetryOptions {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Retries a serialisable transaction that the database aborted.
 *
 * A serialisation failure is not an error in the business sense — it is the
 * database telling us two transactions could not both be true, and that one of
 * them should simply run again. Only that specific failure is retried; anything
 * else propagates immediately, because retrying an unknown failure against a
 * payment system is exactly how a double payout happens.
 */
export async function withSerializationRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  const baseDelay = options.baseDelayMs ?? 20;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === attempts) {
        throw error;
      }
      lastError = error;
      options.onRetry?.(attempt, error);
      const jitter = Math.random() * baseDelay;
      await delay(baseDelay * 2 ** (attempt - 1) + jitter);
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
