import { createHash, randomBytes } from 'crypto';

export const generateOpaqueToken = (bytes = 48): string => randomBytes(bytes).toString('base64url');

export const sha256Hex = (input: string): string => createHash('sha256').update(input).digest('hex');

export const generateNumericCode = (length = 6): string => {
  const max = 10 ** length;
  const n = randomBytes(4).readUInt32BE(0) % max;
  return n.toString().padStart(length, '0');
};
