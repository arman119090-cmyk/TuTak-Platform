import axios from 'axios';

/**
 * What actually went wrong with a request, as a value the UI can switch on.
 *
 * Every one of these renders differently and is acted on differently, and
 * until now they all arrived as "an error": a phone in a lift, a server that
 * took too long, a hostname that does not resolve, a rejected input, a crash
 * on the server, and a deployment in progress. Told apart, the app can say
 * "you are offline" instead of "something went wrong", and — the part that
 * matters for money — can decide whether asking again is safe.
 */
export type NetworkFailureKind =
  /** The device itself has no usable connection. Nothing left the phone. */
  | 'offline'
  /** The request left, and nothing came back before the client gave up. */
  | 'timeout'
  /** The address could not be resolved or the connection was refused. */
  | 'unreachable'
  /** The server answered, and said the request was wrong. */
  | 'client-error'
  /** The server answered, and said it had failed. */
  | 'server-error'
  /** The server answered that it is temporarily unavailable — 503, or 502/504 from a proxy. */
  | 'unavailable'
  /** Something that is not a transport failure at all. */
  | 'unknown';

export interface NetworkFailure {
  kind: NetworkFailureKind;
  /** HTTP status, when the server answered at all. */
  status?: number;
  /**
   * Whether repeating this exact request is safe *as far as the transport is
   * concerned*. It says nothing about whether the operation is idempotent —
   * see `isSafeToRetryAutomatically`.
   */
  transient: boolean;
}

const DNS_OR_CONNECTION = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * Classifies a thrown value, given what the device thinks of its own
 * connection.
 *
 * `isDeviceOffline` is passed in rather than read from a module singleton so
 * this stays a pure function: the same error is "offline" on a phone with no
 * signal and "unreachable" on one with signal and a dead server, and the
 * difference is not visible in the error itself.
 */
export function classifyNetworkFailure(error: unknown, isDeviceOffline: boolean): NetworkFailure {
  if (!axios.isAxiosError(error)) {
    return { kind: 'unknown', transient: false };
  }

  if (error.response) {
    const status = error.response.status;
    if (status === 503 || status === 502 || status === 504) {
      return { kind: 'unavailable', status, transient: true };
    }
    if (status >= 500) return { kind: 'server-error', status, transient: true };
    if (status >= 400) return { kind: 'client-error', status, transient: false };
    return { kind: 'unknown', status, transient: false };
  }

  // No response at all. The device's own state decides what to call it,
  // because a request that never left the phone is not the server's fault and
  // must not be reported as one.
  if (isDeviceOffline) return { kind: 'offline', transient: true };

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return { kind: 'timeout', transient: true };
  }
  if (error.code && DNS_OR_CONNECTION.has(error.code)) {
    return { kind: 'unreachable', transient: true };
  }
  // axios reports a bare "Network Error" for most React Native transport
  // failures, with no code at all.
  return { kind: 'unreachable', transient: true };
}

/**
 * Whether the app may repeat a request on its own.
 *
 * The transport being retryable is only half the question, and the cheaper
 * half. A timeout on `POST /purchase-intents` means the request may have been
 * received, processed and answered — with only the answer lost. Sending it
 * again then creates a second purchase, a second bonus accrual and a second
 * settlement obligation, and the customer sees one purchase charged twice.
 *
 * So retrying is allowed only where repeating the request cannot create a
 * second effect: a read, or a write the server itself deduplicates through an
 * idempotency key. Anything else is handed to the person, who knows whether
 * they pressed the button.
 */
export function isSafeToRetryAutomatically(
  failure: NetworkFailure,
  options: { method: string; hasIdempotencyKey?: boolean },
): boolean {
  if (!failure.transient) return false;
  const method = options.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  return options.hasIdempotencyKey === true;
}
