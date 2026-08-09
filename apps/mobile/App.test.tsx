import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import App from './App';
import i18n from './src/app/i18n/i18n';
import { useAuthStore } from './src/data/stores/authStore';

/**
 * Does the app start?
 *
 * Six test files covered utilities and the auth store, and not one of them
 * ever mounted `App`. The entry point — the provider chain, i18n, navigation,
 * and the single gate between the splash screen and the first usable screen —
 * had no coverage at all, on the one code path that runs before anything else
 * a person could see.
 *
 * That gap is not theoretical. The browser build shipped once showing the
 * TuTak logo and nothing else, forever, because hydration threw before the
 * first screen. Every test in the suite passed while it did.
 *
 * So the assertions here are deliberately about liveness rather than markup:
 * the app leaves its splash screen and arrives somewhere a person can act.
 */

// `SafeAreaProvider` renders nothing until the native side reports the
// device's insets, which never happens here — without this the whole tree
// below it is empty and every assertion fails for a reason that has nothing
// to do with the app. Only the provider and the two hooks are replaced; the
// rest of the module stays real, so `SafeAreaView` still behaves.
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const inset = { top: 44, right: 0, bottom: 34, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaInsetsContext: {
      ...actual.SafeAreaInsetsContext,
      Consumer: ({ children }: { children: (i: typeof inset) => React.ReactNode }) =>
        children(inset),
    },
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => frame,
  };
});

// The signed-in half of the app is stubbed, and the signed-out half is not.
//
// The question this file asks is which of the two `App` hands you, and
// whether it hands you anything at all. For the signed-out answer that has
// to be the real navigator: "reaches the login screen" is only worth
// asserting if the login screen is the real one. For the signed-in answer
// the marker is enough — and mounting the true tree instead drags in a
// notification permission prompt, a live camera, and a fistful of polling
// queries, none of which this file is about and all of which outlive the
// test that started them.
jest.mock('./src/app/navigation/RootNavigator', () => {
  // `require`, not the imports at the top of this file: Jest hoists mock
  // factories above every import, so anything this closure referenced from
  // module scope would still be undefined when it ran.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const react = require('react');
  const { Text } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    RootNavigator: () => react.createElement(Text, null, 'signed-in-app'),
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

/** The login screen's heading, in whichever language the test runner picks. */
const loginHeading = () => i18n.t('auth.welcomeBack');

describe('App', () => {
  // Captured before any test can replace it. One of them substitutes a
  // rejecting `hydrate`, and a zustand store is a module-level singleton —
  // without putting the real one back, every later test in the file would be
  // running against the broken one.
  const realHydrate = useAuthStore.getState().hydrate;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSecureStore.getItemAsync.mockResolvedValue(null);
    mockedSecureStore.setItemAsync.mockResolvedValue();
    // Zustand stores outlive a test file. Without this, the second test
    // starts already hydrated and proves nothing about hydration.
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      deviceId: '',
      isHydrated: false,
      hydrate: realHydrate,
    });
  });

  it('reaches the login screen when there is no stored session', async () => {
    render(<App />);

    // The splash is what the failure mode gets stuck on, so it is worth
    // asserting that it is genuinely where we start.
    expect(screen.getByText('TuTak')).toBeTruthy();

    expect(await screen.findByText(loginHeading())).toBeTruthy();
  });

  it('reaches the login screen even when the keystore cannot be read', async () => {
    // An entry written before an OS upgrade, or restored onto a different
    // handset, throws instead of returning null. Before the adapter guarded
    // this, the throw propagated out of hydration and the app never left the
    // splash — the logo, permanently, with no way even to log out.
    mockedSecureStore.getItemAsync.mockRejectedValue(
      new Error('Could not decrypt the value for key tutak.accessToken'),
    );

    render(<App />);

    expect(await screen.findByText(loginHeading())).toBeTruthy();
  });

  it('reaches the login screen even when the keystore cannot be written', async () => {
    // Hydration writes exactly one thing: a device id, when there is not one
    // already. A phone that refuses that write must still get an app.
    mockedSecureStore.getItemAsync.mockResolvedValue(null);
    mockedSecureStore.setItemAsync.mockRejectedValue(new Error('Keystore is full'));

    render(<App />);

    expect(await screen.findByText(loginHeading())).toBeTruthy();
    // And the id is still usable for this run, because requests carry it.
    await waitFor(() => expect(useAuthStore.getState().deviceId).not.toBe(''));
  });

  it('leaves the splash screen even if hydration rejects outright', async () => {
    // The store is written so this cannot happen. The entry point does not
    // get to depend on that: the `catch` in App is what makes an unforeseen
    // failure a login screen instead of a permanent logo.
    useAuthStore.setState({
      hydrate: jest.fn().mockRejectedValue(new Error('something nobody predicted')),
    });

    render(<App />);

    expect(await screen.findByText(loginHeading())).toBeTruthy();
  });

  it('goes to the signed-in app when a stored session is readable', async () => {
    const user = {
      id: 'user-1',
      phoneNumber: '+37455123456',
      firstName: 'Ani',
      lastName: 'Sargsyan',
      role: 'CUSTOMER',
      isPhoneVerified: true,
    };
    mockedSecureStore.getItemAsync.mockImplementation(async (key: string) => {
      if (key === 'tutak.accessToken') return 'access-token';
      if (key === 'tutak.refreshToken') return 'refresh-token';
      if (key === 'tutak.deviceId') return 'device-1';
      if (key === 'tutak.user') return JSON.stringify(user);
      return null;
    });

    render(<App />);

    expect(await screen.findByText('signed-in-app')).toBeTruthy();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
    expect(screen.queryByText(loginHeading())).toBeNull();
  });

  it('treats an unparseable stored user as no session rather than a crash', async () => {
    mockedSecureStore.getItemAsync.mockImplementation(async (key: string) =>
      key === 'tutak.user' ? '{ this is not json' : null,
    );

    render(<App />);

    expect(await screen.findByText(loginHeading())).toBeTruthy();
  });
});
