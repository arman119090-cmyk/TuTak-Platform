import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth/auth-context';
import { I18nProvider } from '../src/i18n/i18n';
import { ThemeProvider } from '../src/theme/theme';

/**
 * The root. Providers only — no screen logic, so that adding a provider never
 * means touching a screen.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'slide_from_right',
                contentStyle: { backgroundColor: '#FBFCFC' },
              }}
            >
              <Stack.Screen name="index" options={{ animation: 'none' }} />
              <Stack.Screen name="withdraw/processing" options={{ gestureEnabled: false }} />
              <Stack.Screen name="withdraw/success" options={{ gestureEnabled: false }} />
              <Stack.Screen name="withdraw/failure" options={{ gestureEnabled: false }} />
            </Stack>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
