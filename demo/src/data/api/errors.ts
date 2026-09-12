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

/**
 * The API's machine-readable error code, or `null` when there is none.
 *
 * `describeApiError` returns prose written for a person; this returns the
 * identifier written for code. `AllExceptionsFilter` puts one on every error
 * response, and a screen deciding *which field* to mark has to key off that
 * rather than off the wording — a message can be translated or reworded, and
 * a field marked by string-matching would silently start marking the wrong
 * one.
 */
export function apiErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const body = error.response?.data as { code?: string } | undefined;
  return body?.code ?? null;
}

/**
 * Whether the request never reached the API at all.
 *
 * A timeout, a dropped connection, or a service still starting up. It matters
 * because it is the one case where **no** field is at fault: nothing the user
 * typed was ever judged. A staging service on a plan that sleeps takes longer
 * to wake than this app's 15-second timeout allows, so this is not a rare
 * path — it is what the first request after an idle period does.
 */
export function isTransportFailure(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

/**
 * Whether the API refused the *shape* of the request rather than its content.
 *
 * The global `ValidationPipe` answers a 400 whose `message` is an array — one
 * entry per rule broken — and nothing else in this API produces that shape. It
 * is worth telling apart because such a refusal is never about the thing a
 * screen would otherwise blame: a form that treats every non-transport error
 * as "the code you typed is wrong" will show a password-length message against
 * an SMS field and send the customer back a stage to fix something that was
 * never broken. That happened.
 *
 * Keyed on the array rather than on the `Bad Request` string, because the
 * array is what the pipe produces and the string is a label that could be
 * reworded.
 */
export function isValidationFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const body = error.response?.data as { message?: string | string[] } | undefined;
  return Array.isArray(body?.message);
}
