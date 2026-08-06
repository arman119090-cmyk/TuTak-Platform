import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';

import i18n from './src/app/i18n/i18n';
import { ThemeProvider, useAppTheme } from './src/app/theme/ThemeProvider';
import { AuthNavigator } from './src/app/navigation/AuthNavigator';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { useAuthStore } from './src/data/stores/authStore';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Root() {
  const { theme, isDark } = useAppTheme();
  const { user, isHydrated, hydrate } = useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrate().then(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready || !isHydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style={isDark ? 'light' : 'dark'} />
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
