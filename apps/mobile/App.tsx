import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';
import { tutakTheme } from '@tutak/design';

import i18n from './src/app/i18n/i18n';
import { ThemeProvider } from './src/app/theme/ThemeProvider';
import { AuthNavigator } from './src/app/navigation/AuthNavigator';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { SplashScreen } from './src/presentation/screens/SplashScreen';
import { useAuthStore } from './src/data/stores/authStore';
import { usePushRegistration } from './src/app/usePushRegistration';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/**
 * Navigation's own chrome recoloured to the TuTak palette.
 *
 * Built on `DarkTheme` rather than `DefaultTheme` because the base theme is
 * what shows through in the places this object does not reach — the push and
 * pop transition underlay between two screens, most visibly. On the light
 * base that gap flashed white on every navigation.
 */
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: tutakTheme.color.primary,
    background: tutakTheme.color.background,
    card: tutakTheme.color.background,
    text: tutakTheme.color.textPrimary,
    border: tutakTheme.color.border,
  },
};

function Root() {
  const { user, isHydrated, hydrate } = useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrate().then(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Asks for notification permission once a session exists — after someone
  // has signed in and seen what the app does, which is when a prompt has a
  // chance of being allowed.
  usePushRegistration();

  if (!ready || !isHydrated) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style="light" />
      {user ? <RootNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <Root />
          </ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
