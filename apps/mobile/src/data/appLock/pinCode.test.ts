import { createHash, randomBytes } from 'node:crypto';
import * as Crypto from 'expo-crypto';
import { createPinRecord, isValidPin, parsePinRecord, pinMatches, serializePinRecord } from './pinCode';

// Real SHA-256 from Node, so the test proves the stretch is a hash of the
// code and the salt rather than proving that a mock was called. `require`
// inside the factory: Jest hoists it above the imports.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_alg: string, data: string) =>
    require('node:crypto').createHash('sha256').update(data).digest('hex'),
  ),
  getRandomBytes: jest.fn((n: number) => Uint8Array.from(require('node:crypto').randomBytes(n))),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

describe('pinCode', () => {
  it('accepts exactly four digits and nothing else', () => {
    expect(isValidPin('0000')).toBe(true);
    expect(isValidPin('1234')).toBe(true);
    for (const bad of ['123', '12345', 'abcd', '12 4', '', '١٢٣٤']) expect(isValidPin(bad)).toBe(false);
  });

  it('stores a salted hash, never the digits', async () => {
    // The salt is pinned here, and only here. A record is 96 characters of
    // random-looking hex, so a given four-digit run turns up in one by luck
    // about once in six hundred records — measured, not guessed. On
    // 2026-09-21 CI drew a hash containing `1234` and failed a commit that
    // touched nothing but documentation. A fixed salt makes the substring
    // check a statement about the record's shape rather than about the draw;
    // that the salt is random in real use is the next test's job.
    jest
      .mocked(Crypto.getRandomBytes)
      .mockReturnValueOnce(Uint8Array.from({ length: 16 }, (_, i) => i + 1));

    const record = await createPinRecord('1234');
    const raw = serializePinRecord(record);
    expect(record.salt).toBe('0102030405060708090a0b0c0d0e0f10');
    expect(raw).not.toContain('1234');
    // Luck cannot hide a leak in a field either: these four keys are the
    // whole record, so a fifth one carrying the code would fail here even if
    // the hash happened to swallow the digits.
    expect(Object.keys(record).sort()).toEqual(['hash', 'rounds', 'salt', 'v']);
    expect(record.salt).toHaveLength(32);
    expect(record.hash).toHaveLength(64);
    expect(record.hash).not.toBe(createHash('sha256').update('1234').digest('hex'));
  });

  it('matches the right code and refuses every other', async () => {
    const record = await createPinRecord('4821');
    expect(await pinMatches('4821', record)).toBe(true);
    expect(await pinMatches('4822', record)).toBe(false);
    expect(await pinMatches('1284', record)).toBe(false);
    expect(await pinMatches('482', record)).toBe(false);
  });

  it('salts: the same code produces a different record every time', async () => {
    const a = await createPinRecord('7777');
    const b = await createPinRecord('7777');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await pinMatches('7777', b)).toBe(true);
  });

  it('round-trips through storage and treats garbage as no code', async () => {
    const record = await createPinRecord('0919');
    expect(parsePinRecord(serializePinRecord(record))).toEqual(record);
    expect(parsePinRecord(null)).toBeNull();
    expect(parsePinRecord('{ not json')).toBeNull();
    expect(parsePinRecord(JSON.stringify({ v: 2, salt: 'x', hash: 'y', rounds: 1 }))).toBeNull();
    expect(parsePinRecord(JSON.stringify({ v: 1, salt: 'x' }))).toBeNull();
  });

  it('stretches with the configured number of rounds', async () => {
    const digest = jest.mocked(Crypto.digestStringAsync);
    digest.mockClear();
    const record = await createPinRecord('1111');
    expect(digest).toHaveBeenCalledTimes(record.rounds);
    expect(randomBytes(1)).toBeTruthy();
  });
});
