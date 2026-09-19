import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Screen, Text } from '../../src/ui';

/**
 * Legal documents.
 *
 * The app deliberately ships placeholders rather than invented terms. A payout
 * service's terms, privacy notice and data-retention statement are a lawyer's
 * work in the jurisdiction it operates in, and a plausible-looking draft in the
 * binary is worse than an honest gap: it looks reviewed.
 */
export default function LegalScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const { t } = useI18n();

  const title =
    doc === 'privacy'
      ? t('profile.privacy')
      : doc === 'faq'
        ? t('support.faq')
        : t('profile.terms');

  return (
    <Screen
      footer={
        <Button label={t('common.close')} variant="secondary" onPress={() => router.back()} />
      }
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{title}</Text>
      </View>

      <Card style={{ marginTop: theme.spacing.base }}>
        <Text variant="body" tone="secondary">
          This document has not been written yet. It is not a placeholder to fill in with
          boilerplate: the terms of service, the privacy notice and the data-retention policy for a
          payout service are drafted by counsel for the jurisdiction the service operates in, and
          they have to match what the licensed payment partner requires.
        </Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.base }}>
          The app links to them here and will not ship to a store without them.
        </Text>
      </Card>
    </Screen>
  );
}
