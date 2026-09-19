import { CryptoService, constantTimeEquals } from '../../src/common/crypto/crypto.service';
import { Env } from '../../src/config/env';
import { testEnv } from '../harness';

describe('CryptoService', () => {
  const env = testEnv();
  const crypto = new CryptoService(env);

  describe('column encryption', () => {
    it('round-trips a value', () => {
      const secret = 'pm_live_abcdefghijklmnop';
      const envelope = crypto.encrypt(secret);
      expect(envelope).not.toContain(secret);
      expect(crypto.decrypt(envelope)).toBe(secret);
    });

    it('produces a different ciphertext every time', () => {
      const a = crypto.encrypt('same input');
      const b = crypto.encrypt('same input');
      expect(a).not.toBe(b);
      expect(crypto.decrypt(a)).toBe(crypto.decrypt(b));
    });

    it('detects a tampered ciphertext instead of decrypting to garbage', () => {
      const envelope = crypto.encrypt('sensitive');
      const parts = envelope.split(':');
      const corrupted = [...parts.slice(0, 4), flipLastChar(parts[4]!)].join(':');
      expect(() => crypto.decrypt(corrupted)).toThrow();
    });

    it('detects a tampered authentication tag', () => {
      const envelope = crypto.encrypt('sensitive');
      const parts = envelope.split(':');
      const corrupted = [...parts.slice(0, 3), flipLastChar(parts[3]!), parts[4]!].join(':');
      expect(() => crypto.decrypt(corrupted)).toThrow();
    });

    it('refuses a ciphertext written under another key id', () => {
      const other = new CryptoService({ ...env, ENCRYPTION_KEY_ID: 'k2' } as Env);
      const envelope = other.encrypt('sensitive');
      expect(() => crypto.decrypt(envelope)).toThrow(/key/);
    });

    it('refuses an unrecognised envelope', () => {
      expect(() => crypto.decrypt('not-an-envelope')).toThrow(/envelope/);
    });
  });

  describe('secret hashing', () => {
    it('verifies a correct secret and rejects a wrong one', () => {
      const stored = crypto.hashSecret('123456');
      expect(crypto.verifySecret('123456', stored)).toBe(true);
      expect(crypto.verifySecret('123457', stored)).toBe(false);
    });

    it('salts, so the same secret hashes differently each time', () => {
      expect(crypto.hashSecret('123456')).not.toBe(crypto.hashSecret('123456'));
    });

    it('never stores the secret in the hash', () => {
      expect(crypto.hashSecret('123456')).not.toContain('123456');
    });

    it('rejects a malformed stored hash rather than throwing', () => {
      expect(crypto.verifySecret('123456', 'garbage')).toBe(false);
      expect(crypto.verifySecret('123456', 's1:only-two-parts')).toBe(false);
    });

    it('normalises unicode, so the same typed password always verifies', () => {
      const stored = crypto.hashSecret('café');
      expect(crypto.verifySecret('café', stored)).toBe(true);
    });
  });

  describe('fingerprints', () => {
    it('is deterministic within a namespace and differs across namespaces', () => {
      expect(crypto.fingerprint('instrument', 'card-1')).toBe(
        crypto.fingerprint('instrument', 'card-1'),
      );
      expect(crypto.fingerprint('instrument', 'card-1')).not.toBe(
        crypto.fingerprint('licence', 'card-1'),
      );
    });

    it('cannot be reproduced without the pepper', () => {
      const other = new CryptoService({ ...env, FINGERPRINT_KEY: 'd'.repeat(64) } as Env);
      expect(other.fingerprint('instrument', 'card-1')).not.toBe(
        crypto.fingerprint('instrument', 'card-1'),
      );
    });

    it('is not separable by namespace boundary', () => {
      // "a" + "bc" must not collide with "ab" + "c".
      expect(crypto.fingerprint('a', 'bc')).not.toBe(crypto.fingerprint('ab', 'c'));
    });
  });

  describe('quote signatures', () => {
    it('verifies its own signature and rejects anything else', () => {
      const canonical = 'v1|quote|driver|AMD|1000000';
      const signature = crypto.signQuote(canonical);
      expect(crypto.verifyQuote(canonical, signature)).toBe(true);
      expect(crypto.verifyQuote(`${canonical}0`, signature)).toBe(false);
      expect(crypto.verifyQuote(canonical, 'nope')).toBe(false);
      expect(crypto.verifyQuote(canonical, '')).toBe(false);
    });

    it('cannot be forged without the signing key', () => {
      const other = new CryptoService({ ...env, QUOTE_SIGNING_KEY: 'e'.repeat(64) } as Env);
      const canonical = 'v1|quote|driver|AMD|1000000';
      expect(crypto.verifyQuote(canonical, other.signQuote(canonical))).toBe(false);
    });
  });

  describe('random values', () => {
    it('generates OTP codes of the requested length, all digits', () => {
      for (let i = 0; i < 200; i += 1) {
        expect(crypto.generateOtpCode(6)).toMatch(/^\d{6}$/);
      }
    });

    it('spreads OTP codes across the whole range', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 500; i += 1) seen.add(crypto.generateOtpCode(6));
      expect(seen.size).toBeGreaterThan(480);
    });

    it('generates references a human can read out over a phone', () => {
      for (let i = 0; i < 100; i += 1) {
        const reference = crypto.generateReference();
        expect(reference).toMatch(/^CO-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
        // No characters that get confused when spoken or written down.
        // (The "CO-" prefix is fixed and is not part of the random body.)
        expect(reference.slice(3)).not.toMatch(/[01IO]/);
      }
    });

    it('generates distinct tokens', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 200; i += 1) seen.add(crypto.generateToken());
      expect(seen.size).toBe(200);
    });
  });

  describe('constantTimeEquals', () => {
    it('compares correctly regardless of length', () => {
      expect(constantTimeEquals(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
      expect(constantTimeEquals(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
      expect(constantTimeEquals(Buffer.from('abc'), Buffer.from('abcd'))).toBe(false);
      expect(constantTimeEquals(Buffer.from(''), Buffer.from(''))).toBe(true);
    });
  });
});

function flipLastChar(value: string): string {
  const last = value.slice(-1);
  return value.slice(0, -1) + (last === 'A' ? 'B' : 'A');
}
