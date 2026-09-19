import { Decimal } from '@prisma/client/runtime/library';

/**
 * Reading fields off a body that arrived on a public route.
 *
 * Shared by the adapter and the callback controller so there is exactly one
 * opinion about what a hostile body may do. The route is public and the
 * caller is a payment provider that treats a 5xx as "retry harder", so the
 * rule is that nothing here throws: `EDP_AMOUNT[]=1&EDP_AMOUNT[]=2` parses to
 * an array, a JSON body can carry a number or an object, and a request can
 * have no body at all. Every one of those reads as "absent", and absent is
 * refused on the ordinary path with a 200 and the provider's own "no".
 */

/** One field as a plain string, or '' for anything that is not one. */
export function wireField(body: unknown, name: string): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return '';
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
}

/**
 * A decimal amount from the wire, or null.
 *
 * `new Decimal('abc')` throws rather than returning NaN, and the first
 * version of the pre-check reader let that throw escape as a 500. The shape
 * is pinned to digits with an optional fraction: a comma, a sign, an
 * exponent or a currency symbol is a refusal, not a guess.
 */
export function wireMoney(raw: string): Decimal | null {
  if (raw === '' || !/^\d+(\.\d+)?$/.test(raw.trim())) return null;
  try {
    const value = new Decimal(raw.trim());
    return value.isFinite() ? value : null;
  } catch {
    return null;
  }
}
