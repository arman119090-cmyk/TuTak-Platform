import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, PinPad, Screen, Text } from '../../src/ui';

type Step = 'current' | 'new' | 'repeat';

export default function PinChangeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [step, setStep] = useState<Step>('current');
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const complete = async (pin: string) => {
    setValue('');
    if (step === 'current') {
      setCurrent(pin);
      setStep('new');
      return;
    }
    if (step === 'new') {
      setFresh(pin);
      setStep('repeat');
      return;
    }
    if (pin !== fresh) {
      setError(t('security.pinMismatch'));
      setShake((n) => n + 1);
      setStep('new');
      return;
    }
    setBusy(true);
    try {
      await endpoints.changePin(api, { currentPin: current, newPin: pin });
      router.back();
    } catch (caught) {
      setError(describeError(caught));
      setShake((n) => n + 1);
      setStep('current');
      setCurrent('');
      setFresh('');
    } finally {
      setBusy(false);
    }
  };

  const title =
    step === 'current'
      ? t('security.pinCurrentTitle')
      : step === 'new'
        ? t('security.pinNewTitle')
        : t('security.pinRepeatTitle');

  return (
    <Screen
      scroll={false}
      footer={<Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />}
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.xl }}>
        <Text variant="titleLarge" align="center">
          {title}
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
