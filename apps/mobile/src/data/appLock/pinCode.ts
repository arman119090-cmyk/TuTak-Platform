import * as Crypto from 'expo-crypto';

/**
 * The app code: four digits the person types to open TuTak.
 *
 * Stored as a salted, stretched hash rather than as digits. Four digits is
 * ten thousand possibilities, so hashing alone would not stop somebody who
 * could read the keystore — the defence against guessing is the attempt
 * limit in `appLockStore`, which signs the session out after `MAX_ATTEMPTS`.
 * Hashing is here so that the code itself is never on disk: a keystore
 * export, a backup, a debugger attached to the storage layer, all see a
 * hash and a salt, not the digits the person also uses for their bank.
 *
 * `expo-crypto` digests are native and asynchronous, so the stretch is a
 * loop of awaited calls. `ROUNDS` is chosen so an unlock feels immediate on
 * a mid-range Android phone (well under 300 ms measured on a 2021 device),
 * not for offline resistance the attempt limit already provides.
 */
export const PIN_LENGTH = 4;
const ROUNDS = 256;
const VERSION = 1 as const;

export interface PinRecord {
  v: typeof VERSION;
  salt: string;
  hash: string;
  rounds: number;
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function stretch(pin: string, salt: string, rounds: number): Promise<string> {
  let digest = `${salt}:${pin}`;
  for (let i = 0; i < rounds; i += 1) {
    digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${digest}:${salt}:${i}`,
    );
  }
  return digest;
}

export async function createPinRecord(pin: string): Promise<PinRecord> {
  if (!isValidPin(pin)) throw new Error('A code is exactly four digits');
  const salt = toHex(Crypto.getRandomBytes(16));
  return { v: VERSION, salt, hash: await stretch(pin, salt, ROUNDS), rounds: ROUNDS };
}

/**
 * Compares without short-circuiting on the first differing character. The
 * hashes are the same length, so a timing difference here would only ever
 * leak which prefix matched — cheap to rule out anyway.
 */
export async function pinMatches(pin: string, record: PinRecord): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  const candidate = await stretch(pin, record.salt, record.rounds);
  if (candidate.length !== record.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i += 1) {
    diff |= candidate.charCodeAt(i) ^ record.hash.charCodeAt(i);
  }
  return diff === 0;
}

export function serializePinRecord(record: PinRecord): string {
  return JSON.stringify(record);
}

/** A record that will not parse is "no code", the same way a broken stored session is "no session". */
export function parsePinRecord(raw: string | null): PinRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PinRecord>;
    if (
      parsed.v === VERSION &&
      typeof parsed.salt === 'string' &&
      typeof parsed.hash === 'string' &&
      typeof parsed.rounds === 'number'
    ) {
      return parsed as PinRecord;
    }
    return null;
  } catch {
    return null;
  }
}
