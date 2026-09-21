import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { PinPad } from '../../components/PinPad';
import { useAppLockStore } from '../../../data/stores/appLockStore';
import { PIN_LENGTH } from '../../../data/appLock/pinCode';
import { SetPinScreen } from './SetPinScreen';

/**
 * Settings → Security → Change code. The current code first — it counts
 * against the same attempt limit as the lock screen, so this is not a
 * cheaper place to guess — then the ordinary two-step chooser.
 */
export function ChangePinScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const navigation = useNavigation();
  const { busy, verifyPin } = useAppLockStore();
  const [verified, setVerified] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (verified) {
    return (
      <SetPinScreen
        title={t('appLock.newCodeTitle')}
        onDone={() => {
          Alert.alert(t('appLock.changedTitle'), t('appLock.changedBody'));
          navigation.goBack();
        }}
      />
    );
  }

  const onDigit = (digit: string) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    setError(null);
    const next = pin + digit;
    setPin(next);
    if (next.length < PIN_LENGTH) return;
    void verifyPin(next).then((result) => {
      setPin('');
      if (result === 'ok') setVerified(true);
      else if (result === 'wrong') setError(t('appLock.wrongCode', { count: useAppLockStore.getState().attemptsLeft }));
      else if (result === 'signed-out') Alert.alert(t('appLock.tooManyTitle'), t('appLock.tooManyBody'));
    });
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: color.background }]}>
      <View style={[styles.top, { paddingHorizontal: space[5], paddingTop: space[8] }]}>
        <Text accessibilityRole="header" style={[text.title, { color: color.textPrimary }]}>
          {t('appLock.currentCodeTitle')}
        </Text>
        <Text
          accessibilityRole={error ? 'alert' : undefined}
          style={[text.bodySm, styles.error, { color: color.dangerText, marginTop: space[4], minHeight: 20 }]}
        >
          {error ?? ''}
        </Text>
      </View>
      <View style={{ paddingBottom: space[8] }}>
        <PinPad value={pin} onDigit={onDigit} onBackspace={() => setPin((p) => p.slice(0, -1))} disabled={busy} error={!!error} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between' },
  top: { alignItems: 'center' },
  error: { textAlign: 'center' },
});
