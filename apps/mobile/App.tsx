import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/** Navigation's own chrome recoloured to the TuTak palette. */
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
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

  if (!ready || !isHydrated) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style="dark" />
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
