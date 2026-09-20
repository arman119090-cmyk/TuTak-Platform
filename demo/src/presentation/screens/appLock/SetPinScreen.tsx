import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { PinPad } from '../../components/PinPad';
import { useAppLockStore } from '../../../data/stores/appLockStore';
import { PIN_LENGTH } from '../../../data/appLock/pinCode';
import { useBiometricLabel } from './useBiometricLabel';
import { JakoHero } from '../../components/JakoHero';

interface Props {
  /** Called once the code is saved (and the biometric offer, if any, answered). Absent during first setup, where the store's status change is the exit. */
  onDone?: () => void;
  /** Headline override — "Choose a new code" when changing from Settings. */
  title?: string;
}

/**
 * Choose a code, type it again, done — the two-step every phone uses.
 *
 * Mounted in two places: instead of the private navigator while the lock is
 * in `setup` (right after a sign-in, or at cold start for an account that
 * has no code on this phone), and inside `ChangePinScreen` after the old
 * code has been checked. On success, when the phone offers a strong
 * biometric, one dialog asks whether to use it too; declining costs nothing
 * and the switch stays in Settings.
 */
export function SetPinScreen({ onDone, title }: Props) {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const { busy, biometricKind, createPin, enableBiometrics } = useAppLockStore();
  const biometricLabel = useBiometricLabel(biometricKind);
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const finish = async (code: string) => {
    const saved = await createPin(code);
    if (!saved) {
      setError(t('appLock.saveFailed'));
      setFirst(null);
      setPin('');
      return;
    }
    if (!biometricKind) {
      onDone?.();
      return;
    }
    Alert.alert(
      t('appLock.offerTitle', { method: biometricLabel }),
      t('appLock.offerBody', { method: biometricLabel }),
      [
        { text: t('appLock.offerLater'), style: 'cancel', onPress: () => onDone?.() },
        {
          text: t('appLock.offerEnable'),
          onPress: () => {
            void enableBiometrics(t('appLock.biometricPrompt')).then((ok) => {
              if (!ok) Alert.alert(biometricLabel, t('appLock.biometricNotEnabled'));
              onDone?.();
            });
          },
        },
      ],
      { cancelable: true, onDismiss: () => onDone?.() },
    );
  };

  const onDigit = (digit: string) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    setError(null);
    const next = pin + digit;
    setPin(next);
    if (next.length < PIN_LENGTH) return;
    if (first === null) {
      setFirst(next);
      setPin('');
      return;
    }
    if (next !== first) {
      setError(t('appLock.mismatch'));
      setFirst(null);
      setPin('');
      return;
    }
    void finish(next);
  };

  const confirming = first !== null;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: color.background }]}>
      <View style={[styles.top, { paddingHorizontal: space[5], paddingTop: space[8] }]}>
        <JakoHero state="password" size="compact" />
        <Text accessibilityRole="header" style={[text.title, { color: color.textPrimary, marginTop: space[5] }]}>
          {confirming ? t('appLock.confirmTitle') : (title ?? t('appLock.setupTitle'))}
        </Text>
        <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[2], textAlign: 'center' }]}>
          {confirming ? t('appLock.confirmSubtitle') : t('appLock.setupSubtitle')}
        </Text>
        <Text
          accessibilityRole={error ? 'alert' : undefined}
          style={[text.bodySm, styles.error, { color: color.dangerText, marginTop: space[4], minHeight: 20 }]}
        >
          {error ?? ''}
        </Text>
      </View>
      <View style={{ paddingBottom: space[8] }}>
        <PinPad
          value={pin}
          onDigit={onDigit}
          onBackspace={() => setPin((p) => p.slice(0, -1))}
          disabled={busy}
          error={!!error}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between' },
  top: { alignItems: 'center' },
  error: { textAlign: 'center' },
});
