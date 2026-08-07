import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Correlates every log line, and the error body, for one request. */
  requestId: string;
  /** Filled in once the auth guard has resolved the caller. */
  userId?: string;
  method?: string;
  path?: string;
}

/**
 * Per-request state, carried without threading it through every signature.
 *
 * A logger that cannot say *which request* a line belongs to is close to
 * useless under any concurrency: production interleaves requests, so a stack
 * trace and the line that explains it end up separated by unrelated output.
 * `AsyncLocalStorage` follows the async call chain, so a service five layers
 * down logs the same request id as the controller that called it without
 * either of them knowing about the other.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  /** Runs `fn` with `context` visible to everything it awaits. */
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  /**
   * Attaches the caller once authentication has resolved it.
   *
   * Mutates the active store rather than re-running: by the time the guard
   * knows who this is, the request is already inside `run`, and starting a
   * new scope would orphan everything logged before it.
   */
  setUser(userId: string): void {
    const store = storage.getStore();
    if (store) store.userId = userId;
  },
};
