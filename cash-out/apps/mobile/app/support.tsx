import React from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth/auth-context';
import { useI18n } from '../src/i18n/i18n';
import { useTheme } from '../src/theme/theme';
import { Button, Card, ListRow, Screen, Text } from '../src/ui';

const SUPPORT_EMAIL = 'support@cashout.example';

export default function SupportScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const { t } = useI18n();

  /**
   * The pre-filled subject carries the driver's id and fleet. A support ticket
   * that does not say who is asking costs two round trips before anyone can
   * look anything up.
   */
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `Cash Out — ${profile?.phone ?? ''} — ${profile?.parkId ?? ''}`,
  )}`;

  return (
    <Screen
      footer={
        <Button label={t('common.close')} variant="secondary" onPress={() => router.back()} />
      }
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('support.title')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('support.subtitle')}
        </Text>
      </View>

      <Card padded={false} style={{ marginTop: theme.spacing.xl }}>
        <ListRow
          label={t('support.writeUs')}
          value={SUPPORT_EMAIL}
          onPress={() => void Linking.openURL(mailto)}
          first
        />
        <ListRow
          label={t('support.faq')}
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'faq' } })}
          last
        />
      </Card>

      <Card tone="muted" style={{ marginTop: theme.spacing.base }}>
        <Text variant="caption" tone="secondary">
          {t('profile.fleet')}: {profile?.parkId ?? '—'}
        </Text>
        <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
          {t('profile.driverId')}: {profile?.yandexContractorProfileId ?? '—'}
        </Text>
      </Card>
    </Screen>
  );
}
