import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, PinPad, Screen, Text } from '../../src/ui';

/**
 * Setting the PIN: enter it, enter it again. The digits never leave the pad's
 * state except in the one POST that sets them.
 */
export default function PinSetScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const { api } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const complete = async (pin: string) => {
    if (first === null) {
      setFirst(pin);
      setValue('');
      return;
    }
    if (pin !== first) {
      setError(t('security.pinMismatch'));
      setShake((n) => n + 1);
      setFirst(null);
      setValue('');
      return;
    }
    setBusy(true);
    try {
      await endpoints.setPin(api, pin);
      if (params.returnTo) router.replace(params.returnTo as never);
      else router.back();
    } catch (caught) {
      setError(describeError(caught));
      setShake((n) => n + 1);
      setFirst(null);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll={false}
      footer={<Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.xl }}>
        <Text variant="titleLarge" align="center">
          {first === null ? t('security.pinCreateTitle') : t('security.pinRepeatTitle')}
        </Text>
        <Text
          variant="body"
          tone="secondary"
          align="center"
          style={{ marginTop: theme.spacing.xs }}
        >
          {t('security.pinCreateBody')}
        </Text>
      </View>
      <PinPad
        value={value}
        onChange={(next) => {
          setValue(next);
          setError(null);
        }}
        onComplete={(pin) => void complete(pin)}
        disabled={busy}
        error={error}
        shake={shake}
      />
    </Screen>
  );
}
