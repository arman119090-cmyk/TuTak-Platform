import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth/auth-context';
import { I18nProvider } from '../src/i18n/i18n';
import { ThemeProvider, useTheme } from '../src/theme/theme';
import { ToastProvider } from '../src/ui/Toast';

/**
 * The root. Providers only — no screen logic, so that adding a provider never
 * means touching a screen. The navigator's own chrome reads the theme, so a
 * theme change recolours it without remounting it: navigation state and the
 * session survive the switch.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <ToastProvider>
              <ThemedStack />
            </ToastProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStack() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.name === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="withdraw/processing" options={{ gestureEnabled: false }} />
        <Stack.Screen name="withdraw/success" options={{ gestureEnabled: false }} />
        <Stack.Screen name="withdraw/failure" options={{ gestureEnabled: false }} />
      </Stack>
    </>
  );
}
