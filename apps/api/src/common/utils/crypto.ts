import { createHash, randomBytes } from 'crypto';

export const generateOpaqueToken = (bytes = 48): string => randomBytes(bytes).toString('base64url');

export const sha256Hex = (input: string): string => createHash('sha256').update(input).digest('hex');

/**
 * Uniform numeric code.
 *
 * `randomBytes(4) % 10**6` is biased: 2^32 is not a multiple of 10^6, so the
 * low codes come up slightly more often. Harmless while this was dead code,
 * not harmless now that password resets depend on it — rejection sampling
 * discards the values that would skew the distribution.
 */
export const generateNumericCode = (length = 6): string => {
  const max = 10 ** length;
  const limit = Math.floor(0xffffffff / max) * max;
  let n = randomBytes(4).readUInt32BE(0);
  while (n >= limit) {
    n = randomBytes(4).readUInt32BE(0);
  }
  return (n % max).toString().padStart(length, '0');
};
