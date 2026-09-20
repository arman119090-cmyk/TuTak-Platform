import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/auth-context';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Screen, Text } from '../../src/ui';

/**
 * PARK_ACCESS_DENIED / blocked account.
 *
 * The driver is known, but no park will let them withdraw right now — the
 * membership is ineligible, the park is suspended, or the account is blocked.
 * The message says which, and where to ask.
 */
export default function ParkDeniedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, refreshProfile, signOut } = useAuth();
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);

  const blocked = profile?.verificationStatus === 'BLOCKED';

  const checkAgain = async () => {
    setChecking(true);
    try {
      const next = await refreshProfile();
      if (next && next.resolution !== 'NONE' && next.verificationStatus !== 'BLOCKED') {
        router.replace('/');
      }
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
          ⛔
        </Text>
        <Text variant="titleLarge" align="center" style={{ marginTop: theme.spacing.xl }}>
          {t('park.deniedTitle')}
        </Text>
        <Card tone="muted" style={{ marginTop: theme.spacing.xl }}>
          <Text variant="bodyLarge" align="center">
            {blocked ? t('park.blockedBody') : t('park.deniedBody')}
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
