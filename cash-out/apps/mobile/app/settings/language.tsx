import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Locale } from '@cashout/i18n';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Radio, Screen, Text } from '../../src/ui';

const LANGUAGES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'hy', label: 'Հայերեն' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
];

/**
 * The language, changed in place. The choice is stored on the phone first and
 * told to the server second, so a driver offline still gets their language.
 */
export default function LanguageScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t, locale, setLocale } = useI18n();

  return (
    <Screen
      footer={<Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="titleLarge">{t('profile.language')}</Text>
      </View>
      <Card padded={false} style={{ marginTop: theme.spacing.base }}>
        {LANGUAGES.map((language, index) => (
          <Radio
            key={language.code}
            label={language.label}
            selected={language.code === locale}
            onPress={() => {
              setLocale(language.code);
              void endpoints.setLocale(api, language.code).catch(() => undefined);
            }}
            first={index === 0}
            last={index === LANGUAGES.length - 1}
          />
        ))}
      </Card>
    </Screen>
  );
}
