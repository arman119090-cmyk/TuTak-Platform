import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockRequest = jest.fn();
const mockLastKnown = jest.fn();
const mockCurrent = jest.fn();

jest.mock('expo-location', () => ({
  __esModule: true,
  requestForegroundPermissionsAsync: (...a: unknown[]) => mockRequest(...a),
  getLastKnownPositionAsync: (...a: unknown[]) => mockLastKnown(...a),
  getCurrentPositionAsync: (...a: unknown[]) => mockCurrent(...a),
  Accuracy: { Balanced: 3 },
}));

import { DEFAULT_CENTRE, useApproximateLocation } from './useApproximateLocation';

/**
 * Where the map points, and what happens when it cannot find out.
 *
 * The rule this file exists to keep: a refusal is not an error. Someone who
 * declines the prompt must get a working screen centred on the city, and the
 * note that says so — not a retry loop, a second prompt, or a map that sits
 * empty waiting for permission it will never get.
 */
describe('useApproximateLocation', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockLastKnown.mockReset().mockResolvedValue(null);
    mockCurrent.mockReset().mockResolvedValue(null);
  });

  it('starts on the city centre before anything has been asked', () => {
    mockRequest.mockReturnValue(new Promise(() => undefined)); // never settles
    const { result } = renderHook(() => useApproximateLocation());

    expect(result.current).toMatchObject({ ...DEFAULT_CENTRE, isFallback: true, source: 'city', isStale: false });
  });

  it('moves to the real position once the person allows it', async () => {
    mockRequest.mockResolvedValue({ granted: true });
    mockCurrent.mockResolvedValue({ coords: { latitude: 40.2, longitude: 44.6 } });

    const { result } = renderHook(() => useApproximateLocation());

    await waitFor(() => expect(result.current.isFallback).toBe(false));
    expect(result.current).toMatchObject({ lat: 40.2, lng: 44.6, isFallback: false, source: 'fresh', isStale: false });
  });

  it('shows the cached position immediately, then the fresh one', async () => {
    mockRequest.mockResolvedValue({ granted: true });
    mockLastKnown.mockResolvedValue({ coords: { latitude: 40.15, longitude: 44.5 } });
    let resolveFresh: (v: unknown) => void = () => undefined;
    mockCurrent.mockReturnValue(new Promise((resolve) => { resolveFresh = resolve; }));

    const { result } = renderHook(() => useApproximateLocation());

    // A cold GPS fix can take ten seconds; the cached one is usually within a
    // few hundred metres, which for "partners within 25km" is the same answer.
    await waitFor(() => expect(result.current.lat).toBe(40.15));
    expect(result.current.isFallback).toBe(false);
    expect(result.current.source).toBe('cached');
    // The cache is bounded (audit D16): only a recent, reasonably accurate
    // last-known fix counts as one at all.
    expect(mockLastKnown).toHaveBeenCalledWith({ maxAge: 5 * 60_000, requiredAccuracy: 500 });

    await act(async () => {
      resolveFresh({ coords: { latitude: 40.21, longitude: 44.61 } });
    });
    await waitFor(() => expect(result.current.lat).toBe(40.21));
    expect(result.current.source).toBe('fresh');
    expect(result.current.isStale).toBe(false);
  });

  it('marks a cached position stale when the fresh fix times out, and recentre asks again', async () => {
    jest.useFakeTimers();
    try {
      mockRequest.mockResolvedValue({ granted: true });
      mockLastKnown.mockResolvedValue({ coords: { latitude: 40.15, longitude: 44.5 }, timestamp: 1_700_000_000_000 });
      mockCurrent.mockReturnValue(new Promise(() => undefined)); // never answers

      const { result } = renderHook(() => useApproximateLocation());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current).toMatchObject({ lat: 40.15, source: 'cached', isStale: false, fixedAt: 1_700_000_000_000 });

      await act(async () => {
        jest.advanceTimersByTime(8001);
      });
      // Eight seconds and no fix: the cache is what is showing, and the
      // screen is told so instead of being left to call it "you are here".
      expect(result.current.isStale).toBe(true);
      expect(result.current.isFallback).toBe(false);

      mockCurrent.mockResolvedValue({ coords: { latitude: 40.3, longitude: 44.7 }, timestamp: 1_700_000_100_000 });
      await act(async () => {
        result.current.refresh();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockCurrent).toHaveBeenCalledTimes(2);
      expect(result.current).toMatchObject({ lat: 40.3, source: 'fresh', isStale: false });
    } finally {
      jest.useRealTimers();
    }
  });

  it('recentre without permission asks nothing and moves nothing', async () => {
    mockRequest.mockResolvedValue({ granted: false });
    const { result } = renderHook(() => useApproximateLocation());
    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    act(() => result.current.refresh());
    expect(mockCurrent).not.toHaveBeenCalled();
    expect(result.current.isFallback).toBe(true);
  });

  it('stays on the city centre when the person declines', async () => {
    mockRequest.mockResolvedValue({ granted: false });

    const { result } = renderHook(() => useApproximateLocation());

    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    expect(result.current).toMatchObject({ ...DEFAULT_CENTRE, isFallback: true, source: 'city' });
    // No second prompt, and no attempt to read a position it was refused.
    expect(mockCurrent).not.toHaveBeenCalled();
    expect(mockLastKnown).not.toHaveBeenCalled();
  });

  it('stays on the city centre when location services throw', async () => {
    // A device with location switched off, an emulator with no provider, a
    // browser that blocks it — all arrive here and all mean the same thing.
    mockRequest.mockRejectedValue(new Error('location services disabled'));

    const { result } = renderHook(() => useApproximateLocation());

    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    expect(result.current).toMatchObject({ ...DEFAULT_CENTRE, isFallback: true, source: 'city' });
  });

  it('does not update a screen that has already been left', async () => {
    mockRequest.mockResolvedValue({ granted: true });
    let resolveFresh: (v: unknown) => void = () => undefined;
    mockCurrent.mockReturnValue(new Promise((resolve) => { resolveFresh = resolve; }));
    const warn = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { unmount } = renderHook(() => useApproximateLocation());
    await waitFor(() => expect(mockCurrent).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveFresh({ coords: { latitude: 40.3, longitude: 44.7 } });
    });

    // Someone who opens the map and immediately leaves it must not produce a
    // state update on a screen that is gone.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
