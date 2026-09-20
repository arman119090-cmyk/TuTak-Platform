import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth/auth-context';
import { routeForProfile } from '../src/navigation/route-for';
import { useTheme } from '../src/theme/theme';
import { Text } from '../src/ui';

/**
 * Splash and router.
 *
 * It decides where the driver belongs — onboarding, park selection, a "not in
 * any park" screen, or home — and it is the only place that decision is made,
 * so no screen has to guess whether it may be shown.
 */
export default function SplashScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { status, profile } = useAuth();

  useEffect(() => {
    const route = routeForProfile(status, profile);
    if (route) router.replace(route);
  }, [status, profile, router]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.primary }]}>
      <Text variant="amountLarge" tone="inverse">
        Cash Out
      </Text>
      <ActivityIndicator color={theme.colors.onPrimary} style={{ marginTop: theme.spacing.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
