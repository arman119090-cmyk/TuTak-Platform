import { MediaStorage, StoredObject } from './media-storage.interface';

/**
 * The test fake, per spec §3.2 ("tests use an in-memory fake").
 *
 * Kept in `src/` rather than `test/` on purpose: the integration harness boots
 * the real `MediaModule`, and a provider factory cannot import out of the test
 * tree. It is also what a unit test of the image pipeline writes into, so the
 * pipeline's own assertions run against real bytes without touching a disk.
 *
 * Never selected outside a test/`NODE_ENV=test` context — see `MediaModule`.
 */
export class MemoryMediaStorage implements MediaStorage {
  readonly driverName = 'memory';

  private readonly objects = new Map<string, StoredObject>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    // Copied, not referenced. sharp hands back buffers backed by pooled
    // memory; keeping the caller's buffer would let a later write mutate an
    // object that is supposed to be immutable once stored.
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    const found = this.objects.get(key);
    return found ? { body: Buffer.from(found.body), contentType: found.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Test-only introspection. Not on the interface — nothing in `src/` calls it. */
  get size(): number {
    return this.objects.size;
  }
}
