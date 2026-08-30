/**
 * @jest-environment node
 */
// Route handlers run in the Node (or Edge) runtime in production, never
// jsdom — jsdom's environment does not provide the global `Response` this
// route constructs, so this suite opts back into the real runtime.

const mockWithScope = jest.fn((cb: (scope: { setTag: jest.Mock }) => void) => cb({ setTag: jest.fn() }));
const mockCaptureException = jest.fn();
const mockFlush = jest.fn();
jest.mock('@sentry/nextjs', () => ({
  withScope: (cb: (scope: unknown) => void) => mockWithScope(cb),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  flush: (...args: unknown[]) => mockFlush(...args),
}));

import { GET } from './route';

// `NODE_ENV` is typed readonly on `process.env`; these tests need to flip it
// per-case, so route through a mutable view of the same object.
const env = process.env as { NODE_ENV: string; SENTRY_VERIFY_ENABLED?: string };

describe('GET /api/internal/sentry-verify', () => {
  const originalNodeEnv = env.NODE_ENV;
  const originalFlag = env.SENTRY_VERIFY_ENABLED;

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    env.SENTRY_VERIFY_ENABLED = originalFlag;
    mockWithScope.mockClear();
    mockCaptureException.mockClear();
    mockFlush.mockClear();
  });

  it('returns 404 in production even if the flag is enabled', async () => {
    env.NODE_ENV = 'production';
    env.SENTRY_VERIFY_ENABLED = 'true';

    const response = await GET();

    expect(response.status).toBe(404);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('returns 404 outside production when the flag is not set', async () => {
    env.NODE_ENV = 'development';
    delete env.SENTRY_VERIFY_ENABLED;

    const response = await GET();

    expect(response.status).toBe(404);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('sends exactly one synthetic error and reports success outside production with the flag on', async () => {
    env.NODE_ENV = 'development';
    env.SENTRY_VERIFY_ENABLED = 'true';
    mockFlush.mockResolvedValue(true);

    const response = await GET();
    const body = (await response.json()) as { sent: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({ sent: true });
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it('never leaks a stack trace, config, or secret in the response body', async () => {
    env.NODE_ENV = 'development';
    env.SENTRY_VERIFY_ENABLED = 'true';
    mockFlush.mockResolvedValue(true);

    const response = await GET();
    const text = await response.text();

    expect(text).toBe(JSON.stringify({ sent: true }));
  });
});
