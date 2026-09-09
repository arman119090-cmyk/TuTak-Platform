import Constants from 'expo-constants';
import { getAllEvents, resetEvents } from './eventLog';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { diagnostics: true } } },
}));

jest.mock('../../modules/focus-trace', () => ({
  FocusTrace: { start: jest.fn(), stop: jest.fn(), drain: jest.fn(() => []) },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FocusTrace } = require('../../modules/focus-trace');
const start = FocusTrace.start as jest.Mock;
const stop = FocusTrace.stop as jest.Mock;
const drain = FocusTrace.drain as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useNativeFocusTrace } = require('./nativeFocusTrace');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderHook, act } = require('@testing-library/react-native');

const texts = () => getAllEvents().map((e) => e.text);

/**
 * What the native trace is allowed to put in the log.
 *
 * The native side buffers and this drains it, so nothing that happens before
 * JavaScript is ready is lost. What must never be lost in the other direction
 * is the distinction between "the instrument is not here" and "the instrument
 * saw nothing" — those look identical in a log unless the first says so.
 */
describe('the native focus trace', () => {
  beforeEach(() => {
    resetEvents();
    jest.clearAllMocks();
    jest.useFakeTimers();
    drain.mockReturnValue([]);
    void stop;
  });

  afterEach(() => jest.useRealTimers());

  it('says so when it starts, so silence afterwards means something', () => {
    renderHook(() => useNativeFocusTrace());
    expect(start).toHaveBeenCalled();
    expect(texts()).toContain('trace native-focus armed');
  });

  it('writes a drained record with the native timestamp and the stack', () => {
    drain.mockReturnValueOnce([
      {
        uptime: 1234567,
        wall: 1757412345678,
        kind: 'focus',
        from: 'ReactEditText#7',
        to: 'none',
        stack: 'ViewRootImpl.handleWindowFocusChanged:123 < ActivityThread.main:8000',
      },
    ]);

    renderHook(() => useNativeFocusTrace());
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(texts()).toContain(
      'nfocus ReactEditText#7 → none @1234567  ' +
        'ViewRootImpl.handleWindowFocusChanged:123 < ActivityThread.main:8000',
    );
  });

  it('never throws out of the timer when the module goes away', () => {
    drain.mockImplementation(() => {
      throw new Error('module destroyed');
    });

    renderHook(() => useNativeFocusTrace());
    expect(() =>
      act(() => {
        jest.advanceTimersByTime(300);
      }),
    ).not.toThrow();
  });

  it('is silent outside a diagnostic build', () => {
    (Constants as { expoConfig: unknown }).expoConfig = { extra: { diagnostics: false } };

    renderHook(() => useNativeFocusTrace());

    expect(start).not.toHaveBeenCalled();
    expect(texts()).toEqual([]);
    (Constants as { expoConfig: unknown }).expoConfig = { extra: { diagnostics: true } };
  });
});
