import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { ENV, Env } from '../../config/env';

/**
 * Every cryptographic decision in the product, in one auditable place.
 *
 * Choices and why:
 *
 *  - **Column encryption** is AES-256-GCM. The ciphertext carries its key id, so
 *    a key rotation can decrypt old rows while writing new ones under the new
 *    key. Authenticated encryption, so a tampered ciphertext fails loudly rather
 *    than decrypting to garbage.
 *  - **Low-entropy secrets** (OTP codes, admin passwords) are hashed with scrypt.
 *    A fast hash over a six-digit code is worthless: an attacker with the table
 *    enumerates all 10^6 codes instantly.
 *  - **High-entropy secrets** (refresh tokens, 256 bits from a CSPRNG) are hashed
 *    with SHA-256. There is nothing to brute-force, and the lookup has to be fast
 *    on every refresh.
 *  - **Fingerprints** use HMAC with a dedicated pepper, not a bare hash: a bare
 *    SHA-256 of a card token would let anyone who obtains the table confirm a
 *    guess.
 *  - Every comparison of a secret is constant-time.
 */
@Injectable()
export class CryptoService {
  private readonly encryptionKey: Buffer;
  private readonly fingerprintKey: Buffer;
  private readonly quoteKey: Buffer;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.encryptionKey = Buffer.from(env.ENCRYPTION_KEY, 'hex');
    this.fingerprintKey = Buffer.from(env.FINGERPRINT_KEY, 'hex');
    this.quoteKey = Buffer.from(env.QUOTE_SIGNING_KEY, 'hex');
  }

  // ------------------------------------------------------------- encryption

  /** Returns `v1:<keyId>:<iv>:<tag>:<ciphertext>`, all base64url. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      this.env.ENCRYPTION_KEY_ID,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split(':');
    if (parts.length !== 5 || parts[0] !== 'v1') {
      throw new Error('CryptoService.decrypt: unrecognised ciphertext envelope');
    }
    const [, keyId, ivB64, tagB64, dataB64] = parts as [string, string, string, string, string];
    if (keyId !== this.env.ENCRYPTION_KEY_ID) {
      throw new Error(
        `CryptoService.decrypt: ciphertext was written with key "${keyId}" but the process holds "${this.env.ENCRYPTION_KEY_ID}"`,
      );
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  // --------------------------------------------------------------- hashing

  /** scrypt, for anything a human could plausibly guess. */
  hashSecret(secret: string): string {
    const salt = randomBytes(16);
    const derived = scryptSync(secret.normalize('NFKC'), salt, 32, SCRYPT_PARAMS);
    return `s1:${salt.toString('base64url')}:${derived.toString('base64url')}`;
  }

  verifySecret(secret: string, stored: string): boolean {
    const parts = stored.split(':');
    if (parts.length !== 3 || parts[0] !== 's1') return false;
    const salt = Buffer.from(parts[1] as string, 'base64url');
    const expected = Buffer.from(parts[2] as string, 'base64url');
    const derived = scryptSync(secret.normalize('NFKC'), salt, expected.length, SCRYPT_PARAMS);
    return constantTimeEquals(derived, expected);
  }

  /** SHA-256 via HMAC, for tokens this service itself generated. */
  hashToken(token: string): string {
    return createHmac('sha256', this.fingerprintKey).update(token).digest('base64url');
  }

  /** Deterministic, peppered fingerprint for dedupe and fraud signals. */
  fingerprint(namespace: string, value: string): string {
    return createHmac('sha256', this.fingerprintKey)
      .update(namespace)
      .update('\u0000')
      .update(value)
      .digest('base64url');
  }

  // ------------------------------------------------------------- signatures

  signQuote(canonical: string): string {
    return createHmac('sha256', this.quoteKey).update(canonical).digest('base64url');
  }

  verifyQuote(canonical: string, signature: string): boolean {
    return constantTimeEquals(
      Buffer.from(this.signQuote(canonical)),
      Buffer.from(signature ?? ''),
    );
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    return constantTimeEquals(Buffer.from(expected), Buffer.from(signature ?? ''));
  }

  // ----------------------------------------------------------- random values

  /** A numeric OTP code from a CSPRNG. `Math.random` is not acceptable here. */
  generateOtpCode(length: number): string {
    let code = '';
    for (let i = 0; i < length; i += 1) {
      code += randomInt(0, 10).toString();
    }
    return code;
  }

  generateToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Short, unambiguous reference for support calls: no 0/O, no 1/I. */
  generateReference(prefix = 'CO'): string {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let body = '';
    for (let i = 0; i < 10; i += 1) {
      body += alphabet[randomInt(0, alphabet.length)];
    }
    return `${prefix}-${body.slice(0, 5)}-${body.slice(5)}`;
  }
}

/**
 * ~64 MB and ~100 ms per hash on a modern server. Deliberately slow: this runs
 * on login and on OTP verification, never in a hot loop.
 */
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

export function constantTimeEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // timingSafeEqual throws on a length mismatch; still compare something so
    // that the early return does not leak the length by timing alone.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
