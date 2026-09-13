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

    expect(result.current).toEqual({ ...DEFAULT_CENTRE, isFallback: true });
  });

  it('moves to the real position once the person allows it', async () => {
    mockRequest.mockResolvedValue({ granted: true });
    mockCurrent.mockResolvedValue({ coords: { latitude: 40.2, longitude: 44.6 } });

    const { result } = renderHook(() => useApproximateLocation());

    await waitFor(() => expect(result.current.isFallback).toBe(false));
    expect(result.current).toEqual({ lat: 40.2, lng: 44.6, isFallback: false });
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

    await act(async () => {
      resolveFresh({ coords: { latitude: 40.21, longitude: 44.61 } });
    });
    await waitFor(() => expect(result.current.lat).toBe(40.21));
  });

  it('stays on the city centre when the person declines', async () => {
    mockRequest.mockResolvedValue({ granted: false });

    const { result } = renderHook(() => useApproximateLocation());

    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    expect(result.current).toEqual({ ...DEFAULT_CENTRE, isFallback: true });
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
    expect(result.current).toEqual({ ...DEFAULT_CENTRE, isFallback: true });
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
