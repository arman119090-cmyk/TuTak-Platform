import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/auth-context';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Screen, Text } from '../../src/ui';

/**
 * DRIVER_NOT_FOUND: the phone is in no park's roster.
 *
 * It names the number, because the most common cause is a driver registered
 * under a different one, and it offers "check again" rather than a dead end:
 * parks add drivers while drivers are looking at this screen.
 */
export default function ParkNotFoundScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, refreshProfile, signOut } = useAuth();
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);

  const checkAgain = async () => {
    setChecking(true);
    try {
      const next = await refreshProfile();
      if (next && next.resolution !== 'NONE') router.replace('/');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t('park.checkAgain')}
            onPress={() => void checkAgain()}
            loading={checking}
          />
          <Button
            label={t('profile.support')}
            variant="secondary"
            onPress={() => router.push('/support')}
          />
          <Button
            label={t('profile.signOut')}
            variant="ghost"
            onPress={() => void signOut().then(() => router.replace('/'))}
          />
        </View>
      }
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: theme.spacing.xxxl }}>
        <Text variant="amountLarge" align="center">
          🚕
        </Text>
        <Text variant="titleLarge" align="center" style={{ marginTop: theme.spacing.xl }}>
          {t('park.notFoundTitle')}
        </Text>
        <Card tone="muted" style={{ marginTop: theme.spacing.xl }}>
          <Text variant="bodyLarge" align="center">
            {t('park.notFoundBody', { phone: profile?.phone ?? '' })}
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
