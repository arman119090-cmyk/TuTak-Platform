import axios from 'axios';

/**
 * Pulls the human-readable reason out of an API error.
 *
 * The server distinguishes "insufficient balance" from "this code has expired"
 * from "bonus applied cannot exceed the payment amount". Collapsing all of
 * them into one generic string left the customer unable to tell which of those
 * had happened, or what to do about it.
 */
export function describeApiError(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;

  const body = error.response?.data as { message?: string | string[] } | undefined;
  if (!body?.message) return null;

  return Array.isArray(body.message) ? body.message.join('. ') : body.message;
}
