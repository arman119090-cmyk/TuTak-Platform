import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Screen, Text } from '../../src/ui';

/** Placeholder until the notification preferences block lands. */
export default function NotificationsSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  return (
    <Screen
      footer={<Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('notifications.title')}</Text>
      </View>
      <Card style={{ marginTop: theme.spacing.base }}>
        <Text variant="body" tone="secondary">
          {t('common.loading')}
        </Text>
      </Card>
    </Screen>
  );
}
