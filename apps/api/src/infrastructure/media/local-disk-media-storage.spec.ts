import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { LocalDiskMediaStorage } from './local-disk-media-storage';
import { MemoryMediaStorage } from './memory-media-storage';
import { mintMediaKeys } from './media-keys';

/**
 * The dev driver, and the one place a server-minted key becomes a filesystem
 * path — which is the one place getting it wrong means writing outside the
 * media root.
 */
describe('LocalDiskMediaStorage', () => {
  let root: string;
  let storage: LocalDiskMediaStorage;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'tutak-media-'));
    storage = new LocalDiskMediaStorage(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('round-trips bytes and content type', async () => {
    const key = mintMediaKeys('PARTNER_LOGO').display;
    await storage.put(key, Buffer.from('hello'), 'image/webp');
    const out = await storage.get(key);
    expect(out?.body.toString()).toBe('hello');
    expect(out?.contentType).toBe('image/webp');
  });

  it('returns null for a key that was never written', async () => {
    expect(await storage.get('avatar/ab/abcdef/display')).toBeNull();
  });

  it('deletes idempotently', async () => {
    const key = mintMediaKeys('USER_AVATAR').thumb;
    await storage.put(key, Buffer.from('x'), 'image/webp');
    await storage.delete(key);
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });

  it.each([
    ['../escape', 'a parent-directory hop'],
    ['a/../../escape', 'a hop buried mid-path'],
    ['/etc/passwd', 'an absolute path'],
    ['a//b', 'an empty segment'],
    ['A/Uppercase', 'anything outside the minted alphabet'],
    ['a b', 'a space'],
  ])('refuses %s (%s)', async (key) => {
    await expect(storage.put(key, Buffer.from('x'), 'image/webp')).rejects.toThrow(/unsafe|outside/i);
    await expect(storage.get(key)).rejects.toThrow(/unsafe|outside/i);
  });

  it('never writes outside its root', async () => {
    const key = mintMediaKeys('PARTNER_COVER').original;
    await storage.put(key, Buffer.from('x'), 'image/webp');
    expect(existsSync(path.join(root, key))).toBe(true);
  });
});

describe('MemoryMediaStorage', () => {
  it('copies buffers in and out rather than aliasing the caller’s', async () => {
    // sharp hands back pooled buffers; an aliased store would let a later
    // write mutate an object that is supposed to be immutable once stored.
    const storage = new MemoryMediaStorage();
    const original = Buffer.from('abc');
    await storage.put('k', original, 'image/webp');
    original.write('zzz');
    const out = await storage.get('k');
    expect(out?.body.toString()).toBe('abc');
    out!.body.write('yyy');
    expect((await storage.get('k'))?.body.toString()).toBe('abc');
  });
});

describe('mintMediaKeys', () => {
  it('mints three distinct, unguessable keys per asset', () => {
    const a = mintMediaKeys('USER_AVATAR');
    const b = mintMediaKeys('USER_AVATAR');
    expect(new Set([a.original, a.display, a.thumb]).size).toBe(3);
    expect(a.display).not.toBe(b.display);
  });

  it('derives nothing from the subject — keys carry only the kind', () => {
    const key = mintMediaKeys('PARTNER_LOGO').display;
    expect(key.startsWith('partner-logo/')).toBe(true);
    expect(key).toMatch(/^[a-z0-9][a-z0-9/_-]*$/);
  });
});
