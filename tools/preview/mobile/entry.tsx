/**
 * Mobile preview harness.
 *
 * Mounts the *real, unmodified* screen components from apps/mobile through
 * react-native-web, wrapped in the app's own providers (ThemeProvider,
 * i18n, react-query, SafeAreaProvider), and points the API client at the
 * running backend so every number on screen is live data.
 *
 * This exists because the screenshot container has no iOS/Android emulator.
 * It renders the same components the device build renders — it is not a
 * mockup and contains no hand-drawn UI.
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nextProvider } from 'react-i18next';

import i18n from '../../../apps/mobile/src/app/i18n/i18n';
import { ThemeProvider } from '../../../apps/mobile/src/app/theme/ThemeProvider';
import { useAuthStore } from '../../../apps/mobile/src/data/stores/authStore';

import { SplashScreen } from '../../../apps/mobile/src/presentation/screens/SplashScreen';
import { LoginScreen } from '../../../apps/mobile/src/presentation/screens/auth/LoginScreen';
import { RegisterScreen } from '../../../apps/mobile/src/presentation/screens/auth/RegisterScreen';
import { HomeScreen } from '../../../apps/mobile/src/presentation/screens/home/HomeScreen';
import { WalletScreen } from '../../../apps/mobile/src/presentation/screens/wallet/WalletScreen';
import { MyQrScreen } from '../../../apps/mobile/src/presentation/screens/qr/MyQrScreen';
import { ScanQrScreen } from '../../../apps/mobile/src/presentation/screens/qr/ScanQrScreen';
import { EvStationsScreen } from '../../../apps/mobile/src/presentation/screens/ev/EvStationsScreen';
import { EvHistoryScreen } from '../../../apps/mobile/src/presentation/screens/ev/EvHistoryScreen';
import { ReferralScreen } from '../../../apps/mobile/src/presentation/screens/referral/ReferralScreen';
import { TransactionHistoryScreen } from '../../../apps/mobile/src/presentation/screens/transactions/TransactionHistoryScreen';
import { NotificationsScreen } from '../../../apps/mobile/src/presentation/screens/notifications/NotificationsScreen';
import { SettingsScreen } from '../../../apps/mobile/src/presentation/screens/settings/SettingsScreen';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'home';
const session = JSON.parse(decodeURIComponent(params.get('session') ?? '{}'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 0, staleTime: Infinity, refetchOnWindowFocus: false } },
});

/** Minimal navigation double — screens only ever call navigate/goBack. */
const nav = {
  navigate: () => {},
  goBack: () => {},
  push: () => {},
  replace: () => {},
  setOptions: () => {},
  addListener: () => () => {},
  canGoBack: () => true,
} as never;

const SCREENS: Record<string, React.ReactNode> = {
  splash: <SplashScreen />,
  login: <LoginScreen navigation={nav} route={{ key: 'l', name: 'Login' } as never} />,
  register: <RegisterScreen navigation={nav} route={{ key: 'r', name: 'Register' } as never} />,
  home: <HomeScreen navigation={nav} route={{ key: 'h', name: 'Home' } as never} />,
  wallet: <WalletScreen />,
  'my-qr': <MyQrScreen />,
  'scan-qr': <ScanQrScreen />,
  'ev-stations': <EvStationsScreen />,
  'ev-history': <EvHistoryScreen />,
  referral: <ReferralScreen />,
  transactions: <TransactionHistoryScreen />,
  notifications: <NotificationsScreen />,
  settings: <SettingsScreen />,
};

function Harness() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Seed the auth store in memory exactly as a real sign-in would, minus
    // the SecureStore persistence the web target cannot provide.
    if (session.user) {
      useAuthStore.setState({
        user: session.user,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        deviceId: 'preview',
        isHydrated: true,
      });
    }
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 59, left: 0, right: 0, bottom: 34 },
      }}
    >
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <View style={{ width: 390, height: 844, backgroundColor: '#FFFFFF' }}>
              {SCREENS[screen] ?? <View />}
            </View>
          </ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
