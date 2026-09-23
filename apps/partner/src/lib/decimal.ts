/**
 * Exact decimal arithmetic for the few places the panel checks money itself.
 *
 * The server compares a cashier's line item with `Decimal`: quantity × unit
 * price must *equal* the gross. The panel mirrored that check with `Number`,
 * and 33.3 × 480 is 15983.999999999998 in floating point — so a correct fuel
 * sale was drawn in red as "does not match 15 984", next to a total that read
 * 15 984. The cashier saw the platform disagreeing with itself.
 */
type Scaled = { units: bigint; scale: number };

/**
 * The decimal a person typed, in the form the API validates: digits, an
 * optional dot, no spaces. A comma is read as the decimal separator — it is
 * the one a Russian or Armenian keyboard puts there. `null` when it is not a
 * plain non-negative decimal.
 */
export function normalizeDecimal(input: string): string | null {
  const cleaned = input.trim().replace(/\s+/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(cleaned) ? cleaned : null;
}

function scaled(input: string): Scaled | null {
  const normalized = normalizeDecimal(input);
  if (normalized === null) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function align(value: Scaled, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

/** `a × b`, exactly, as a plain decimal string; `null` if either is not a number. */
export function multiplyExact(a: string, b: string): string | null {
  const x = scaled(a);
  const y = scaled(b);
  if (!x || !y) return null;
  const units = x.units * y.units;
  const scale = x.scale + y.scale;
  if (scale === 0) return units.toString();
  const digits = units.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** Whether two decimals are the same number: `15984` equals `15984.0000`. */
export function decimalEquals(a: string, b: string): boolean {
  const x = scaled(a);
  const y = scaled(b);
  if (!x || !y) return false;
  const scale = Math.max(x.scale, y.scale);
  return align(x, scale) === align(y, scale);
}
