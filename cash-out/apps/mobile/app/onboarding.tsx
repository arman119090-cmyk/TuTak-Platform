import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Locale } from '@cashout/i18n';
import { useI18n } from '../src/i18n/i18n';
import { useTheme } from '../src/theme/theme';
import { Button, Screen, Text } from '../src/ui';

/**
 * A language row, three sentences and a button.
 *
 * The language comes first because everything after it is words: a driver who
 * lands on the wrong language cannot read the explanation of how to change it.
 * Each option is written in its own language for the same reason. The choice is
 * saved on the phone at once and sent to the server after sign-in, so the next
 * launch opens in it.
 *
 * The temptation with onboarding is to explain the product; the driver does not
 * want an explanation, they want their money. This says what will happen and
 * gets out of the way.
 */
const LANGUAGES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'hy', label: 'Հայերեն' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
];

export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();

  const steps: Array<{ key: string; label: string }> = [
    { key: '1', label: t('onboarding.step1') },
    { key: '2', label: t('onboarding.step2') },
    { key: '3', label: t('onboarding.step3') },
  ];

  return (
    <Screen
      footer={
        <Button label={t('onboarding.start')} onPress={() => router.push('/sign-in/phone')} />
      }
    >
      <View style={{ paddingTop: theme.spacing.xl }}>
        <Text variant="label" tone="secondary">
          {t('onboarding.language')}
        </Text>
        <View style={[styles.languages, { marginTop: theme.spacing.sm }]}>
          {LANGUAGES.map((language) => (
            <Button
              key={language.code}
              label={language.label}
              size="medium"
              fullWidth={false}
              style={{ flex: 1 }}
              variant={language.code === locale ? 'primary' : 'secondary'}
              onPress={() => setLocale(language.code)}
              accessibilityState={{ selected: language.code === locale }}
            />
          ))}
        </View>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: theme.spacing.xxl }}>
        <Text variant="amountLarge" tone="brand">
          Cash&nbsp;Out
        </Text>
        <Text variant="titleLarge" style={{ marginTop: theme.spacing.xl }}>
          {t('onboarding.title')}
        </Text>
        <Text variant="bodyLarge" tone="secondary" style={{ marginTop: theme.spacing.md }}>
          {t('onboarding.body')}
        </Text>

        <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.base }}>
          {steps.map((step) => (
            <View key={step.key} style={styles.step}>
              <View
                style={[
                  styles.bullet,
                  {
                    backgroundColor: theme.colors.primarySoft,
                    borderRadius: theme.radius.pill,
                  },
                ]}
              >
                <Text variant="label" tone="brand">
                  {step.key}
                </Text>
              </View>
              <Text variant="bodyLarge" style={{ flex: 1 }}>
                {step.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  languages: { flexDirection: 'row', gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bullet: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
