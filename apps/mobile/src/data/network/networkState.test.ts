import { onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import {
  __setOfflineForTests,
  getIsOffline,
  isStateOffline,
  startNetworkStateTracking,
} from './networkState';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));

const addEventListener = NetInfo.addEventListener as jest.Mock;

describe('isStateOffline', () => {
  it('is offline when the device says it is not connected', () => {
    expect(isStateOffline({ isConnected: false, isInternetReachable: null })).toBe(true);
  });

  /**
   * The captive-portal case: attached to Wi-Fi, reaching nothing. Treating it
   * as online is how "no internet" turns into "something went wrong" five
   * screens deep.
   */
  it('is offline when connected to a network that reaches nothing', () => {
    expect(isStateOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
  });

  it('is online while reachability is still unknown', () => {
    // null means "not probed yet". Flashing an offline banner on every cold
    // start would be worse than being briefly wrong.
    expect(isStateOffline({ isConnected: true, isInternetReachable: null })).toBe(false);
  });

  it('is online when connected and reachable', () => {
    expect(isStateOffline({ isConnected: true, isInternetReachable: true })).toBe(false);
  });
});

describe('startNetworkStateTracking', () => {
  let listeners: ((state: unknown) => void)[] = [];
  const unsubscribe = jest.fn();

  beforeEach(() => {
    listeners = [];
    unsubscribe.mockClear();
    addEventListener.mockReset();
    addEventListener.mockImplementation((listener: (state: unknown) => void) => {
      listeners.push(listener);
      return unsubscribe;
    });
    __setOfflineForTests(false);
    onlineManager.setOnline(true);
  });

  const emit = (state: { isConnected: boolean; isInternetReachable: boolean | null }) => {
    for (const listener of [...listeners]) listener(state);
  };

  it('follows the device from online to offline and back', () => {
    const stop = startNetworkStateTracking();

    emit({ isConnected: false, isInternetReachable: false });
    expect(getIsOffline()).toBe(true);

    emit({ isConnected: true, isInternetReachable: true });
    expect(getIsOffline()).toBe(false);

    stop();
  });

  /**
   * The integration that matters: TanStack Query pauses and resumes on its own
   * `onlineManager`, which on React Native has no browser event to listen to.
   * Feeding it the same signal is what keeps the banner and the data layer
   * from disagreeing — and is why this is not a second networking system.
   */
  it('drives TanStack Query’s online state from the same signal', () => {
    const stop = startNetworkStateTracking();

    emit({ isConnected: false, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);

    emit({ isConnected: true, isInternetReachable: true });
    expect(onlineManager.isOnline()).toBe(true);

    stop();
  });

  it('unsubscribes when stopped, so the listener cannot outlive the app', () => {
    const stop = startNetworkStateTracking();
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
