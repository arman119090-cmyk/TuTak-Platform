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

  it('scrubs a sensitive field through the configured beforeSend', () => {
    mockExtra = { sentryDsn: 'https://example@o0.ingest.sentry.io/1' };
    initSentry();
    const options = mockInit.mock.calls[0]![0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };
    const result = options.beforeSend({ extra: { refreshToken: 'xyz' } });
    expect((result.extra as Record<string, unknown>).refreshToken).toBe('[Filtered]');
  });
});
