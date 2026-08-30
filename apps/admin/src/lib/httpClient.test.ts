import axios from 'axios';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import { httpClient } from './httpClient';
import { useAuthStore } from './stores/authStore';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, default: { ...actual.default, post: jest.fn() }, post: jest.fn() };
});

const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

/**
 * The 401-refresh-and-retry interceptor.
 *
 * Security-relevant in two directions. It is the piece that keeps the
 * refresh token out of JavaScript's hands — the browser attaches it as an
 * httpOnly cookie and this code only ever sends a device id (audit §H2). And
 * it is the piece that decides what happens when a session really has
 * expired: getting that wrong either loops forever against a server saying
 * no, or leaves a dead session looking alive.
 */
describe('admin httpClient interceptor', () => {
  /** Replaces the transport so no real request leaves the process. */
  const respondWith = (fn: (config: AxiosRequestConfig) => Promise<unknown>): jest.Mock => {
    const adapter = jest.fn(fn) as unknown as jest.Mock;
    httpClient.defaults.adapter = adapter as unknown as AxiosAdapter;
    return adapter;
  };

  const unauthorized = (config: AxiosRequestConfig) =>
    Promise.reject(
      Object.assign(new Error('Request failed with status code 401'), {
        isAxiosError: true,
        config,
        response: { status: 401, data: {}, statusText: 'Unauthorized', headers: {}, config },
      }),
    );

  const ok = (config: AxiosRequestConfig) =>
    Promise.resolve({
      data: { data: 'fine' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });

  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({ user: null, accessToken: 'expired-token', hasRestored: true });
    mockedPost.mockReset();
  });

  it('attaches the access token to outgoing requests', async () => {
    const adapter = respondWith(ok);
    await httpClient.get('/wallet/me');

    const sent = adapter.mock.calls[0]![0] as AxiosRequestConfig;
    expect(sent.headers?.Authorization).toBe('Bearer expired-token');
  });

  it('refreshes once on a 401 and replays the original request', async () => {
    mockedPost.mockResolvedValue({
      data: { data: { tokens: { accessToken: 'fresh-token', refreshToken: 'ignored' } } },
    } as never);

    let call = 0;
    const adapter = respondWith((config) => {
      call += 1;
      return call === 1 ? unauthorized(config) : ok(config);
    });

    const response = await httpClient.get('/wallet/me');

    expect(response.data).toEqual({ data: 'fine' });
    expect(adapter).toHaveBeenCalledTimes(2);
    // The replay carries the new token, not the one that just failed.
    const replay = adapter.mock.calls[1]![0] as AxiosRequestConfig;
    expect(replay.headers?.Authorization).toBe('Bearer fresh-token');
    expect(useAuthStore.getState().accessToken).toBe('fresh-token');
  });

  it('never sends the refresh token itself — only the device id', async () => {
    mockedPost.mockResolvedValue({
      data: { data: { tokens: { accessToken: 'fresh-token', refreshToken: 'ignored' } } },
    } as never);

    let call = 0;
    respondWith((config) => {
      call += 1;
      return call === 1 ? unauthorized(config) : ok(config);
    });
    await httpClient.get('/wallet/me');

    const [, body, options] = mockedPost.mock.calls[0]!;
    expect(Object.keys(body as object)).toEqual(['deviceId']);
    // The cookie only travels when credentials are allowed.
    expect((options as { withCredentials?: boolean }).withCredentials).toBe(true);
  });

  it('gives up after one refresh rather than looping against a server saying no', async () => {
    mockedPost.mockResolvedValue({
      data: { data: { tokens: { accessToken: 'fresh-token', refreshToken: 'ignored' } } },
    } as never);

    // Every attempt is refused, including the replay.
    const adapter = respondWith(unauthorized);

    await expect(httpClient.get('/wallet/me')).rejects.toThrow();
    // Original plus exactly one replay — the `_retry` flag stops the second
    // 401 from starting the whole dance again.
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('clears the session when the refresh itself is refused', async () => {
    mockedPost.mockRejectedValue(new Error('refresh cookie expired'));
    respondWith(unauthorized);

    await expect(httpClient.get('/wallet/me')).rejects.toThrow();

    // A dead session must look dead, or the UI keeps showing a logged-in
    // shell over an account that can no longer do anything.
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('shares one refresh between requests that 401 together', async () => {
    let resolveRefresh: (v: unknown) => void = () => {};
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }) as never,
    );

    const seen = new Set<string>();
    respondWith((config) => {
      const key = `${config.url}:${seen.has(config.url!) ? 'retry' : 'first'}`;
      if (!seen.has(config.url!)) {
        seen.add(config.url!);
        return unauthorized(config);
      }
      void key;
      return ok(config);
    });

    const both = Promise.all([httpClient.get('/a'), httpClient.get('/b')]);
    // Let both 401s land before the refresh resolves.
    await new Promise((r) => setTimeout(r, 0));
    resolveRefresh({
      data: { data: { tokens: { accessToken: 'fresh-token', refreshToken: 'ignored' } } },
    });
    await both;

    // Two requests, one refresh. Without the shared promise each would start
    // its own, and the server would rotate the refresh token twice —
    // invalidating whichever landed second.
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('passes a non-401 error through without touching the session', async () => {
    respondWith((config) =>
      Promise.reject(
        Object.assign(new Error('Request failed with status code 500'), {
          isAxiosError: true,
          config,
          response: { status: 500, data: {}, statusText: 'Server Error', headers: {}, config },
        }),
      ),
    );

    await expect(httpClient.get('/wallet/me')).rejects.toThrow(/500/);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(useAuthStore.getState().accessToken).toBe('expired-token');
  });
});
