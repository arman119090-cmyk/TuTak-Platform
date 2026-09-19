import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  readonly ip?: string;
  readonly userAgent?: string;
  userId?: string;
  driverId?: string;
  adminUserId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Carries the request id (and who is acting) through every layer without
 * threading it into forty signatures. The audit log and the logger both read
 * from here, which is why an audit row can never be written without knowing
 * which request produced it.
 */
export const requestContext = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
  set<K extends keyof RequestContext>(key: K, value: RequestContext[K]): void {
    const store = storage.getStore();
    if (store) {
      (store as unknown as Record<string, unknown>)[key as string] = value;
    }
  },
};
