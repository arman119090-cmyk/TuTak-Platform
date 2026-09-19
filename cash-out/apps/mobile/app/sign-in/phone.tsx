import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Input, Screen, Text } from '../../src/ui';

/**
 * Phone entry.
 *
 * The country code is fixed in the prefix rather than offered as a picker: this
 * launches in one country, and a picker is one more thing to get wrong with a
 * thumb. It becomes a picker the day a second country ships, not before.
 */
export default function PhoneScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api, deviceId } = useAuth();
  const { t, locale } = useI18n();
  const describeError = useErrorMessage();

  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phone = `+374${digits}`;
  const valid = /^\d{8}$/.test(digits);

  const submit = async () => {
    if (!valid) {
      setError(t('auth.phoneInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const challenge = await endpoints.requestOtp(api, { phone, deviceId, locale });
      router.push({
        pathname: '/sign-in/otp',
        params: {
          challengeId: challenge.challengeId,
          phone,
          codeLength: String(challenge.codeLength),
          resendAfter: String(challenge.resendAfterSeconds),
        },
      });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t('common.continue')}
            onPress={submit}
            loading={busy}
            disabled={!valid}
          />
          <Text variant="caption" tone="tertiary" align="center">
            {t('auth.legalNote')}
          </Text>
        </View>
      }
    >
      <View style={{ paddingTop: theme.spacing.xxl }}>
        <Text variant="titleLarge">{t('auth.phoneTitle')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
          {t('auth.phoneSubtitle')}
        </Text>

        <View style={{ marginTop: theme.spacing.xxl }}>
          <Input
            label={t('auth.phonePlaceholder')}
            prefix="+374"
            value={digits}
            onChangeText={(text) => {
              setDigits(text.replace(/\D/g, '').slice(0, 8));
              setError(null);
            }}
            keyboardType="phone-pad"
            inputMode="tel"
            autoComplete="tel"
            textContentType="telephoneNumber"
            placeholder="00 00 00 00"
            autoFocus
            error={error}
            maxLength={8}
            onSubmitEditing={submit}
            returnKeyType="go"
          />
        </View>
      </View>
    </Screen>
  );
}
