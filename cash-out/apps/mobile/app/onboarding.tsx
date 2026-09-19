import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useI18n } from '../src/i18n/i18n';
import { useTheme } from '../src/theme/theme';
import { Button, Screen, Text } from '../src/ui';

/**
 * Three sentences and a button.
 *
 * The temptation with onboarding is to explain the product; the driver does not
 * want an explanation, they want their money. This says what will happen and
 * gets out of the way.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();

  const steps: Array<{ key: string; label: string }> = [
    { key: '1', label: t('onboarding.step1') },
    { key: '2', label: t('onboarding.step2') },
    { key: '3', label: t('onboarding.step3') },
  ];

  return (
    <Screen
      footer={<Button label={t('onboarding.start')} onPress={() => router.push('/sign-in/phone')} />}
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: theme.spacing.xxxl }}>
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
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bullet: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
