import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';
import { tutakTheme } from '@tutak/design';

import { ErrorBoundary } from './src/app/ErrorBoundary';
import i18n from './src/app/i18n/i18n';
import { ThemeProvider } from './src/app/theme/ThemeProvider';
import { AuthNavigator } from './src/app/navigation/AuthNavigator';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { SplashScreen } from './src/presentation/screens/SplashScreen';
import { useAuthStore } from './src/data/stores/authStore';
import { usePushRegistration } from './src/app/usePushRegistration';
import { DiagnosticOverlay } from './src/diagnostics/DiagnosticOverlay';

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
  const { user, hydrate } = useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // This is the only gate between the splash screen and the app, so it has
    // to open however hydration turns out. A rejected promise here shows the
    // logo forever, with no error and no way out — the failure the browser
    // build shipped with once already. The store is written so it cannot
    // reject; this does not rely on that staying true.
    //
    // The `catch` is what makes it safe, not the ordering: `finally` alone
    // passes the rejection along to nobody, which is an unhandled rejection
    // and a red box on top of an app that did start.
    hydrate()
      .catch(() => undefined)
      .then(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Asks for notification permission once a session exists — after someone
  // has signed in and seen what the app does, which is when a prompt has a
  // chance of being allowed.
  usePushRegistration();

  // One latch, not two. This used to also require the store's `isHydrated`,
  // which is only raised on the success path — so any failure inside
  // hydration left both flags disagreeing and the splash screen up. `ready`
  // means "hydration has settled", which is the actual question being asked
  // here, and it is answered whichever way hydration went.
  if (!ready) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style="light" />
      {user ? <RootNavigator /> : <AuthNavigator />}
      {/*
        Inside the navigator so it sits over whatever screen is showing, and
        last so nothing paints over it. Renders `null` in every build except
        the `diagnostic` profile — see `isDiagnosticBuild`.
      */}
      <DiagnosticOverlay />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    // Outermost on purpose: a failure anywhere below — the theme, i18n, the
    // navigator, a screen — becomes a readable message rather than a blank
    // screen or a redraw nobody can diagnose from a photograph.
    <ErrorBoundary>
      <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <Root />
          </ThemeProvider>
        </QueryClientProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
