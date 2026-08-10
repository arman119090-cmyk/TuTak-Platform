import { authApi } from './authApi';
import { healthUrl, httpClient } from './httpClient';

/**
 * The demo entry point exists only because the server said it is a demo, so
 * this function decides whether anyone can get into the app without an
 * account. It is also the easiest thing in the codebase to get wrong quietly:
 * every failure mode returns `false`, which looks exactly like "not a demo".
 *
 * It was wrong. The first version read `data.demoMode` from a response that
 * is enveloped as `{ data: { ... }, timestamp }` like every other response
 * this API sends, so a healthy demo server produced `undefined === true` and
 * the button never appeared anywhere. The request had succeeded, so nothing
 * threw and nothing logged. The tests that existed around it checked how the
 * URL is derived and stopped there.
 *
 * These tests use the shape the server actually sends. The first one fails if
 * the envelope is unwrapped by one level too few or too many.
 */
describe('authApi.isDemoDeployment', () => {
  const get = jest.spyOn(httpClient, 'get');

  afterEach(() => {
    get.mockReset();
  });

  it('is true when the server reports demo mode in the envelope it really sends', async () => {
    get.mockResolvedValue({
      data: { data: { status: 'ok', demoMode: true }, timestamp: '2026-08-10T06:18:29.862Z' },
    });

    await expect(authApi.isDemoDeployment()).resolves.toBe(true);
  });

  it('asks the version-free health path, not the versioned base URL', async () => {
    get.mockResolvedValue({ data: { data: { status: 'ok', demoMode: true } } });

    await authApi.isDemoDeployment();

    expect(get).toHaveBeenCalledWith(healthUrl);
    expect(healthUrl).not.toMatch(/\/v\d/);
  });

  it('is false on a real deployment, which reports demo mode off', async () => {
    get.mockResolvedValue({ data: { data: { status: 'ok', demoMode: false } } });

    await expect(authApi.isDemoDeployment()).resolves.toBe(false);
  });

  it('is false when the server is too old to mention demo mode at all', async () => {
    get.mockResolvedValue({ data: { data: { status: 'ok' } } });

    await expect(authApi.isDemoDeployment()).resolves.toBe(false);
  });

  it('is false, not a crash, when the server cannot be reached', async () => {
    get.mockRejectedValue(new Error('Network Error'));

    await expect(authApi.isDemoDeployment()).resolves.toBe(false);
  });

  it('is false when the body is not the shape this API sends', async () => {
    get.mockResolvedValue({ data: 'demoMode: true' });

    await expect(authApi.isDemoDeployment()).resolves.toBe(false);
  });
});
