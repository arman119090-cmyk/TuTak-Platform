const initSentryMock = jest.fn();
jest.mock('../common/observability/sentry', () => ({
  initSentry: (...args: unknown[]) => initSentryMock(...args),
}));

const scopeMock = { setTag: jest.fn() };
const withScopeMock = jest.fn((cb: (scope: typeof scopeMock) => void) => cb(scopeMock));
const captureExceptionMock = jest.fn();
const flushMock = jest.fn().mockResolvedValue(true);
jest.mock('@sentry/node', () => ({
  withScope: (cb: (scope: typeof scopeMock) => void) => withScopeMock(cb),
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  flush: (...args: unknown[]) => flushMock(...args),
}));

import { safeErrorType } from '../common/observability/sentry-sanitize';
import {
  assertNotProduction,
  runSentryVerify,
  SentryVerifyRefusedInProductionError,
} from './sentry-verify';

describe('sentry-verify — the non-production gate', () => {
  it('throws when NODE_ENV is production', () => {
    expect(() => assertNotProduction('production')).toThrow(SentryVerifyRefusedInProductionError);
  });

  it.each(['development', 'staging', 'test', ''])('allows %s through', (env) => {
    expect(() => assertNotProduction(env)).not.toThrow();
  });

  it('runSentryVerify refuses before touching Sentry at all when NODE_ENV is production', async () => {
    await expect(runSentryVerify('production')).rejects.toBeInstanceOf(
      SentryVerifyRefusedInProductionError,
    );
    expect(initSentryMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('reports no DSN rather than pretending to have sent an event', async () => {
    initSentryMock.mockReturnValue(false);
    const result = await runSentryVerify('development');
    expect(result.sent).toBe(false);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('sends exactly one synthetic error and confirms the flush when a DSN is configured', async () => {
    initSentryMock.mockReturnValue(true);
    const result = await runSentryVerify('development');
    expect(result.sent).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(flushMock).toHaveBeenCalledTimes(1);
  });

  it('sends a probe whose class name survives the sanitizer, since its message will not', async () => {
    initSentryMock.mockReturnValue(true);
    await runSentryVerify('development');
    const sentError = captureExceptionMock.mock.calls[0]![0] as Error;
    // The sanitizer drops every free-text field but keeps an
    // identifier-shaped `exception.type`, which Sentry takes from `name`.
    expect(sentError.name).toBe('SentryVerificationProbe');
    expect(safeErrorType(sentError.name)).toBe('SentryVerificationProbe');
  });

  it('tags the probe with service and kind, both of which are on the tag allowlist', async () => {
    initSentryMock.mockReturnValue(true);
    await runSentryVerify('development');
    expect(scopeMock.setTag).toHaveBeenCalledWith('service', 'api');
    expect(scopeMock.setTag).toHaveBeenCalledWith('kind', 'sentry-verify');
  });
});
