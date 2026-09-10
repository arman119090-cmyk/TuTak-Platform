import Constants from 'expo-constants';
import { getAllEvents, resetEvents, startedAtMs } from './eventLog';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { diagnostics: true } } },
}));

jest.mock('../../modules/focus-trace', () => ({
  FocusTrace: {
    start: jest.fn(),
    stop: jest.fn(),
    drain: jest.fn(),
    inspect: jest.fn(),
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { FocusTrace } = require('../../modules/focus-trace');
const start = FocusTrace.start as jest.Mock;
const stop = FocusTrace.stop as jest.Mock;
const drain = FocusTrace.drain as jest.Mock;
const inspect = FocusTrace.inspect as jest.Mock;

const { useNativeFocusTrace, logNativeShape } = require('./nativeFocusTrace');
const { renderHook, act } = require('@testing-library/react-native');
/* eslint-enable @typescript-eslint/no-require-imports */

const texts = () => getAllEvents().map((e) => e.text);

const ARMED = { ok: true, focus: true, window: true, attach: 1, alive: true, sdk: 34, reason: '' };

/**
 * What the native trace is allowed to put in the log.
 *
 * The native side buffers and this drains it, so nothing that happens before
 * JavaScript is ready is lost. What must never be lost in the other direction
 * is the distinction between "the instrument is not here", "the instrument is
 * here but did not start" and "the instrument saw nothing" — all three look
 * identical in a log unless each says so.
 */
describe('the native focus trace', () => {
  beforeEach(() => {
    resetEvents();
    jest.clearAllMocks();
    jest.useFakeTimers();
    start.mockReturnValue(ARMED);
    drain.mockReturnValue({ records: [], dropped: 0 });
    void stop;
  });

  afterEach(() => jest.useRealTimers());

  it('reports which observers actually installed, not that it tried', () => {
    renderHook(() => useNativeFocusTrace());

    expect(start).toHaveBeenCalled();
    expect(texts()).toContain(
      'trace native-focus armed focus=1 window=1 attach=1 alive=1 sdk=34',
    );
  });

  /**
   * The failure this exists for: an observer that never installed, on a build
   * where every other line looks healthy. "No native lines" would then read
   * as "no focus changes happened", which is the opposite of the truth.
   */
  it('says NOT ARMED, with the reason, when an observer did not install', () => {
    start.mockReturnValue({
      ok: false,
      focus: false,
      window: false,
      attach: 0,
      alive: false,
      sdk: 27,
      reason: 'no decor view',
    });

    renderHook(() => useNativeFocusTrace());
    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(texts()).toContain(
      'trace native-focus NOT ARMED focus=0 window=0 attach=0 alive=0 sdk=27 (no decor view)',
    );
    // Nothing is drained from an instrument that is not running: a stream of
    // empty drains would suggest it was.
    expect(drain).not.toHaveBeenCalled();
  });

  /**
   * Two clocks, kept apart.
   *
   * A drained row reaches the log up to one drain interval after the event,
   * and in the build-40 capture that put `ndetach` on either side of the
   * `blur` it belongs with. `ev=` is when it happened, the row's own column
   * is when it was collected, and `lag=` is the distance between them.
   */
  it('carries the event time, the lag, and both native clocks', () => {
    const wall = startedAtMs() + 22588;
    drain.mockReturnValueOnce({
      records: [
        {
          uptime: 1301074,
          wall,
          kind: 'detach',
          from: 'ReactEditText#2988',
          to: '-',
          stack: 'ViewGroup.removeViewAt:5000 < ReactClippingViewManager.removeViewAt:68',
        },
      ],
      dropped: 0,
    });

    renderHook(() => useNativeFocusTrace());
    act(() => {
      jest.advanceTimersByTime(300);
    });

    const line = texts().find((text) => text.startsWith('ndetach'));
    expect(line).toContain('ndetach ReactEditText#2988 → -');
    expect(line).toContain('ev=22588');
    expect(line).toMatch(/ lag=-?\d+ /);
    expect(line).toContain('u=1301074');
    expect(line).toContain(`w=${wall}`);
    expect(line).toContain('ReactClippingViewManager.removeViewAt:68');
  });

  /**
   * A dropped record and a quiet moment are the same shape in a log, and one
   * of them means the instrument failed. It has to say so, and before the
   * records it did keep, so the gap is read in the right place.
   */
  it('announces records the buffer had to throw away', () => {
    drain.mockReturnValueOnce({
      records: [{ uptime: 1, wall: startedAtMs(), kind: 'focus', from: 'a', to: 'b', stack: '' }],
      dropped: 17,
    });

    renderHook(() => useNativeFocusTrace());
    act(() => {
      jest.advanceTimersByTime(300);
    });

    const lines = texts();
    expect(lines).toContain('ntrace DROPPED 17 records (buffer full)');
    expect(lines.indexOf('ntrace DROPPED 17 records (buffer full)')).toBeLessThan(
      lines.findIndex((text) => text.startsWith('nfocus')),
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

/**
 * Whether `collapsable={false}` reached the native view.
 *
 * This is the line that decides what a negative `CF` result is worth. Fabric
 * mounts a flattened node's children into an ancestor, so `kids=0` on the
 * field box means flattened and `kids=2` means not — read from the view tree
 * rather than inferred from whether the fault happened. Without it, "CF
 * changed nothing" could mean the hypothesis is wrong or could mean the prop
 * never arrived, and those are not the same finding.
 */
describe('the native shape probe', () => {
  beforeEach(() => {
    resetEvents();
    jest.clearAllMocks();
  });

  it('records the parent and the child count of the box', async () => {
    inspect.mockResolvedValue({
      found: true,
      tag: 2990,
      cls: 'ReactViewGroup',
      parent: 'ReactViewGroup#2992',
      kids: 2,
    });

    await logNativeShape('phone', 2990);

    expect(inspect).toHaveBeenCalledWith(2990);
    expect(texts()).toContain('shape phone #2990 ReactViewGroup parent=ReactViewGroup#2992 kids=2');
  });

  it('says the view was not found rather than reporting a shape it did not read', async () => {
    inspect.mockResolvedValue({ found: false, tag: 4242 });

    await logNativeShape('phone', 4242);

    expect(texts()).toContain('shape phone #4242 NOT FOUND');
  });

  it('says nothing at all when there is no tag to ask about', async () => {
    await logNativeShape('phone', null);

    expect(inspect).not.toHaveBeenCalled();
    expect(texts()).toEqual([]);
  });
});
