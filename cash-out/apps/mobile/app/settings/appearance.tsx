import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme, useThemePreference, type ThemePreference } from '../../src/theme/theme';
import { Button, Card, Radio, Screen, Text } from '../../src/ui';

/** Light, dark, or the phone's own — persisted on the device, applied at once. */
export default function AppearanceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const { preference, setPreference } = useThemePreference();

  const options: ReadonlyArray<{ value: ThemePreference; label: string }> = [
    { value: 'light', label: t('appearance.light') },
    { value: 'dark', label: t('appearance.dark') },
    { value: 'system', label: t('appearance.system') },
  ];

  return (
    <Screen
      footer={<Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('appearance.title')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('appearance.hint')}
        </Text>
      </View>
      <Card padded={false} style={{ marginTop: theme.spacing.base }}>
        {options.map((option, index) => (
          <Radio
            key={option.value}
            label={option.label}
            selected={preference === option.value}
            onPress={() => setPreference(option.value)}
            first={index === 0}
            last={index === options.length - 1}
          />
        ))}
      </Card>
    </Screen>
  );
}
