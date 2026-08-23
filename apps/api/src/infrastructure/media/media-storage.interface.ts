/**
 * The storage boundary for every processed image this platform holds
 * (TUTAK_V2_MEDIA_SYSTEM_SPEC.md §3.2).
 *
 * Deliberately tiny, and deliberately not an object-storage SDK in disguise:
 * no bucket names, no ACLs, no presigning, no listing. A key in, bytes out.
 * Everything policy-shaped — who may read an object, what URL a client is
 * given, how long that URL lives — is the API's decision and lives in
 * `MediaDeliveryService`, not down here. That is what makes the fake used by
 * the test suite a faithful stand-in rather than an approximation.
 *
 * The keys are opaque and always minted by the server (`MediaKeys`). No
 * caller-supplied path, filename or URL ever reaches an implementation of
 * this interface — the spec is explicit that a caller-provided URL must never
 * become the source of truth, and the simplest way to guarantee that is for
 * the caller never to name anything.
 */
export interface MediaStorage {
  /**
   * Human-readable driver name, for the boot log and `/health`. Not a
   * capability flag — nothing branches on it.
   */
  readonly driverName: string;

  /** Writes (or overwrites) an object. Idempotent by key. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;

  /** Reads an object, or null when the key does not exist. */
  get(key: string): Promise<StoredObject | null>;

  /**
   * Removes an object.
   *
   * Used only for the narrow cases where an object should genuinely stop
   * existing: a rejected/superseded *pending* submission nobody ever saw, and
   * cleanup after a failed multi-derivative write. Revoking a published asset
   * does **not** call this — spec §3.3 keeps record-needed derivatives.
   */
  delete(key: string): Promise<void>;
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
