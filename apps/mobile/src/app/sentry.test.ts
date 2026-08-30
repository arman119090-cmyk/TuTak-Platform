const mockInit = jest.fn();
jest.mock('@sentry/react-native', () => ({ init: (...args: unknown[]) => mockInit(...args) }));

let mockExtra: Record<string, unknown> = {};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: mockExtra }; } },
}));

import { initSentry } from './sentry';

describe('initSentry (mobile)', () => {
  beforeEach(() => {
    mockInit.mockClear();
    mockExtra = {};
  });

  it('does nothing and returns false when the build carries no DSN', () => {
    mockExtra = { sentryDsn: '', appEnv: 'production', commit: 'abc1234' };
    expect(initSentry()).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('is a no-op on a build with no `extra` at all (e.g. the generated demo app)', () => {
    mockExtra = {};
    expect(() => initSentry()).not.toThrow();
    expect(initSentry()).toBe(false);
  });

  it('initializes with tracing disabled and the build\'s environment/release when a DSN is present', () => {
    mockExtra = { sentryDsn: 'https://example@o0.ingest.sentry.io/1', appEnv: 'production', commit: 'abc1234' };
    expect(initSentry()).toBe(true);
    expect(mockInit).toHaveBeenCalledTimes(1);
    const options = mockInit.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.dsn).toBe('https://example@o0.ingest.sentry.io/1');
    expect(options.environment).toBe('production');
    expect(options.release).toBe('abc1234');
    expect(options.tracesSampleRate).toBe(0);
    expect(options.sendDefaultPii).toBe(false);
    expect((options.initialScope as { tags: Record<string, string> }).tags.service).toBe('mobile');
  });

  function configuredBeforeSend() {
    mockExtra = { sentryDsn: 'https://example@o0.ingest.sentry.io/1' };
    initSentry();
    return (mockInit.mock.calls[0]![0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    }).beforeSend;
  }

  it('has the strict allowlist policy wired into beforeSend', () => {
    const beforeSend = configuredBeforeSend();

    const result = beforeSend({
      message: 'password hunter2 for Арман',
      request: { url: '/v1/users/Арман' },
      user: { email: 'a@b.com' },
      extra: { opaque: 'Zx9QpLm2Vt7RhK4NsE1BgYcW' },
      contexts: { custom: { ssn: '123-45-6789' } },
      tags: { service: 'mobile', customerName: 'Арман Петросян' },
      exception: { values: [{ type: 'Error', value: 'password hunter2' }] },
    });

    expect(result.message).toBeUndefined();
    expect(result.request).toBeUndefined();
    expect(result.user).toBeUndefined();
    expect(result.extra).toBeUndefined();
    expect(result.contexts).toBeUndefined();
    expect(result.tags).toEqual({ service: 'mobile' });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('Арман');
    expect(serialized).not.toContain('a@b.com');
    expect(serialized).not.toContain('Zx9QpLm2Vt7RhK4NsE1BgYcW');
    expect(serialized).not.toContain('customerName');
  });

  it('has the strict allowlist policy wired into beforeBreadcrumb', () => {
    mockExtra = { sentryDsn: 'https://example@o0.ingest.sentry.io/1' };
    initSentry();
    const options = mockInit.mock.calls[0]![0] as {
      beforeBreadcrumb: (crumb: Record<string, unknown>) => Record<string, unknown>;
    };

    const result = options.beforeBreadcrumb({
      category: 'xhr',
      message: 'GET /v1/users/Арман',
      data: { body: 'password hunter2' },
    });

    expect(result).toEqual({ category: 'xhr' });
  });
});
