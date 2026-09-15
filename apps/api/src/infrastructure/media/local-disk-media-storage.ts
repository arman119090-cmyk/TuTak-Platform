import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { MediaStorage, StoredObject } from './media-storage.interface';

/**
 * A directory on this machine. **Local development and the demo stack only.**
 *
 * Spec §3.2 is explicit that this must never be enabled in production: it
 * fails across replicas (replica B cannot read what replica A wrote), across
 * backups (the database is backed up, this directory is not, so every
 * `MediaAsset` row survives a restore pointing at bytes that do not) and
 * across redeploys (a container filesystem is not durable). `MediaModule`
 * refuses to boot `NODE_ENV=production` on this driver — the guard is there,
 * not here, because a driver should not be the thing deciding whether it is
 * allowed to exist.
 *
 * Objects are never served from a static file mount. The only way out of this
 * directory is `MediaDeliveryService`, which applies the same authorisation
 * and signature checks it applies to any other driver — a static mount would
 * make every customer avatar world-readable to anyone who guessed a key,
 * which is the exact failure the local driver is most likely to be blamed
 * for and least likely to be noticed causing.
 */
export class LocalDiskMediaStorage implements MediaStorage {
  readonly driverName = 'local-disk';

  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    // Write-then-rename: a reader must never observe a half-written image,
    // and the delivery route can be hit the instant the row is committed.
    const staging = `${file}.${createHash('sha256').update(body).digest('hex').slice(0, 12)}.tmp`;
    await writeFile(staging, body);
    await writeFile(`${file}.type`, contentType, 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(staging, file);
  }

  async get(key: string): Promise<StoredObject | null> {
    const file = this.resolve(key);
    try {
      const [body, contentType] = await Promise.all([
        readFile(file),
        readFile(`${file}.type`, 'utf8').catch(() => 'application/octet-stream'),
      ]);
      return { body, contentType: contentType.trim() };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(`${file}.type`, { force: true });
  }

  /**
   * Keys are minted by `MediaKeys` and are already constrained to
   * `[a-z0-9/_-]`, but this is the one place a key becomes a filesystem path,
   * so it is also the one place where being wrong means writing outside the
   * media root. Re-checked here rather than trusted, and the resolved path is
   * additionally asserted to stay under the root — belt and braces, because
   * the cost of the check is nothing and the cost of missing it is arbitrary
   * file write.
   */
  private resolve(key: string): string {
    if (!/^[a-z0-9][a-z0-9/_-]*$/.test(key) || key.includes('..') || key.includes('//')) {
      throw new Error(`Refusing to resolve an unsafe media key: ${JSON.stringify(key)}`);
    }
    const resolved = path.resolve(this.root, key);
    const rootWithSep = path.resolve(this.root) + path.sep;
    if (!resolved.startsWith(rootWithSep)) {
      throw new Error(`Refusing to resolve a media key outside the media root: ${JSON.stringify(key)}`);
    }
    return resolved;
  }
}
