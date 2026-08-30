const mockWithScope = jest.fn((cb: (scope: { setTag: jest.Mock }) => void) => cb({ setTag: jest.fn() }));
const mockCaptureException = jest.fn();
const mockFlush = jest.fn();
jest.mock('@sentry/react-native', () => ({
  withScope: (cb: (scope: unknown) => void) => mockWithScope(cb),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  flush: (...args: unknown[]) => mockFlush(...args),
}));

let mockExtra: Record<string, unknown> = {};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

import { isSentryProbeAvailable, runSentryProbe, SentryVerificationProbe } from './sentryProbe';

/** What the `diagnostic` EAS profile actually produces. */
const DIAGNOSTIC_PREVIEW = { diagnostics: true, appEnv: 'preview' };

describe('isSentryProbeAvailable', () => {
  beforeEach(() => {
    mockExtra = {};
  });

  it.each(['preview', 'staging'])(
    'is available in a diagnostic build of the %s environment',
    (appEnv) => {
      mockExtra = { diagnostics: true, appEnv };
      expect(isSentryProbeAvailable()).toBe(true);
    },
  );

  it('is absent from a production build even when the diagnostic flag is somehow set', () => {
    mockExtra = { diagnostics: true, appEnv: 'production' };
    expect(isSentryProbeAvailable()).toBe(false);
  });

  it('is absent from a non-diagnostic build of an allowed environment', () => {
    mockExtra = { diagnostics: false, appEnv: 'preview' };
    expect(isSentryProbeAvailable()).toBe(false);
  });

  it('is absent when the diagnostic flag is missing entirely', () => {
    mockExtra = { appEnv: 'preview' };
    expect(isSentryProbeAvailable()).toBe(false);
  });

  it('is absent from an ordinary development build', () => {
    mockExtra = { diagnostics: true, appEnv: 'development' };
    expect(isSentryProbeAvailable()).toBe(false);
  });

  it('is absent when `extra` is empty — the generated demo app, for one', () => {
    mockExtra = {};
    expect(isSentryProbeAvailable()).toBe(false);
  });

  it('is not fooled by a truthy non-boolean diagnostic flag', () => {
    mockExtra = { diagnostics: 'true', appEnv: 'preview' };
    expect(isSentryProbeAvailable()).toBe(false);
  });
});

describe('runSentryProbe', () => {
  beforeEach(() => {
    mockExtra = { ...DIAGNOSTIC_PREVIEW };
    mockWithScope.mockClear();
    mockCaptureException.mockClear();
    mockFlush.mockClear();
    mockFlush.mockResolvedValue(true);
  });

  it('captures a probe and flushes it when deliberately triggered', async () => {
    await expect(runSentryProbe()).resolves.toBe('sent');

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0]![0]).toBeInstanceOf(SentryVerificationProbe);
    expect((mockCaptureException.mock.calls[0]![0] as Error).name).toBe('SentryVerificationProbe');
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it('attaches only the two allowlisted tags', async () => {
    const setTag = jest.fn();
    mockWithScope.mockImplementationOnce((cb) => cb({ setTag }));

    await runSentryProbe();

    expect(setTag.mock.calls).toEqual([
      ['service', 'mobile'],
      ['kind', 'sentry-verify'],
    ]);
  });

  it('says so rather than lying when the flush is not confirmed', async () => {
    mockFlush.mockResolvedValue(false);
    await expect(runSentryProbe()).resolves.toBe('not-flushed');
  });

  it('refuses, and captures nothing, in a production build', async () => {
    mockExtra = { diagnostics: true, appEnv: 'production' };

    await expect(runSentryProbe()).resolves.toBe('unavailable');
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(mockWithScope).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('refuses, and captures nothing, in a non-diagnostic build', async () => {
    mockExtra = { diagnostics: false, appEnv: 'preview' };

    await expect(runSentryProbe()).resolves.toBe('unavailable');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('is never called by merely importing the module', () => {
    // The guarantee is that nothing fires on startup: the only caller is a
    // press handler in the diagnostic overlay.
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
