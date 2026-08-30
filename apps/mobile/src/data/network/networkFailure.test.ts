import { AxiosError, AxiosHeaders } from 'axios';
import {
  classifyNetworkFailure,
  isSafeToRetryAutomatically,
  type NetworkFailure,
} from './networkFailure';

const axiosError = (init: { code?: string; status?: number }): AxiosError => {
  const error = new AxiosError('failed', init.code);
  if (init.status !== undefined) {
    error.response = {
      status: init.status,
      statusText: '',
      data: {},
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
  }
  return error;
};

describe('classifyNetworkFailure', () => {
  it('calls a request that never left the phone offline, whatever the error says', () => {
    expect(classifyNetworkFailure(axiosError({ code: 'ERR_NETWORK' }), true)).toEqual({
      kind: 'offline',
      transient: true,
    });
  });

  it('separates a timeout from a phone with no signal', () => {
    expect(classifyNetworkFailure(axiosError({ code: 'ECONNABORTED' }), false)).toEqual({
      kind: 'timeout',
      transient: true,
    });
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'])('treats %s as unreachable', (code) => {
    expect(classifyNetworkFailure(axiosError({ code }), false).kind).toBe('unreachable');
  });

  it('reports a bare React Native "Network Error" as unreachable when the device is online', () => {
    expect(classifyNetworkFailure(axiosError({}), false).kind).toBe('unreachable');
  });

  it.each([400, 401, 403, 404, 409, 422])('treats %s as a client error, not transient', (status) => {
    expect(classifyNetworkFailure(axiosError({ status }), false)).toEqual({
      kind: 'client-error',
      status,
      transient: false,
    });
  });

  it.each([500, 501])('treats %s as a server error', (status) => {
    expect(classifyNetworkFailure(axiosError({ status }), false).kind).toBe('server-error');
  });

  it.each([502, 503, 504])('treats %s as temporarily unavailable', (status) => {
    expect(classifyNetworkFailure(axiosError({ status }), false).kind).toBe('unavailable');
  });

  it('does not pretend a non-transport error is one', () => {
    expect(classifyNetworkFailure(new Error('boom'), false)).toEqual({
      kind: 'unknown',
      transient: false,
    });
  });
});

describe('isSafeToRetryAutomatically', () => {
  const timeout: NetworkFailure = { kind: 'timeout', transient: true };
  const rejected: NetworkFailure = { kind: 'client-error', status: 422, transient: false };

  it('allows a read to be repeated', () => {
    expect(isSafeToRetryAutomatically(timeout, { method: 'get' })).toBe(true);
  });

  /**
   * The rule this module exists for. A timeout on a purchase means the server
   * may have already created it and lost only the answer; sending it again
   * charges the customer twice.
   */
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses to repeat %s on its own', (method) => {
    expect(isSafeToRetryAutomatically(timeout, { method })).toBe(false);
  });

  it('allows a write the server itself deduplicates', () => {
    expect(isSafeToRetryAutomatically(timeout, { method: 'POST', hasIdempotencyKey: true })).toBe(
      true,
    );
  });

  it('never repeats anything the server actively rejected', () => {
    expect(isSafeToRetryAutomatically(rejected, { method: 'GET' })).toBe(false);
    expect(
      isSafeToRetryAutomatically(rejected, { method: 'POST', hasIdempotencyKey: true }),
    ).toBe(false);
  });
});
