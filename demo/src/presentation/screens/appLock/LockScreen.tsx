import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { PinPad } from '../../components/PinPad';
import { JakoWingMark } from '../../components/V2NavIcon';
import { useAppLockStore } from '../../../data/stores/appLockStore';
import { useAuthStore } from '../../../data/stores/authStore';
import { authApi } from '../../../data/api/authApi';
import { PIN_LENGTH } from '../../../data/appLock/pinCode';
import { useBiometricLabel } from './useBiometricLabel';

/**
 * Shown instead of the private navigator while the lock is `locked`.
 *
 * Biometrics first: when the account enabled them, the OS prompt opens by
 * itself as soon as this screen appears and the app is in the foreground —
 * one glance and the wallet is open. Cancelling the prompt leaves the
 * keypad, which is always there. A wrong code says how many tries remain;
 * the last one ends the session (see `appLockStore`).
 *
 * "Forgot the code" is a sign-out: the server session is revoked when the
 * network allows, the local one always, and the person signs in by SMS and
 * chooses a new code. There is nothing else it can be — a code recovery that
 * did not go through the phone number would be a bypass.
 */
export function LockScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const { busy, biometricsEnabled, biometricKind, attemptsLeft, unlockWithPin, unlockWithBiometrics } =
    useAppLockStore();
  const biometricLabel = useBiometricLabel(biometricKind);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // This screen mounts fresh on every lock (it is unmounted while unlocked),
  // so "once per mount" is "once per lock".
  const prompted = useRef(false);

  const tryBiometrics = useCallback(() => {
    if (!biometricsEnabled || busy) return;
    setError(null);
    void unlockWithBiometrics(t('appLock.biometricPrompt'));
  }, [biometricsEnabled, busy, unlockWithBiometrics, t]);

  // Once per lock, and only while the app is actually in front: a prompt
  // raised from the background is dismissed by the OS before anyone sees it.
  useEffect(() => {
    if (!biometricsEnabled) return;
    const attempt = () => {
      if (AppState.currentState !== 'active') return;
      if (prompted.current) return;
      prompted.current = true;
      tryBiometrics();
    };
    attempt();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') attempt();
    });
    return () => sub.remove();
  }, [biometricsEnabled, tryBiometrics]);

  const submit = useCallback(
    async (candidate: string) => {
      const result = await unlockWithPin(candidate);
      setPin('');
      if (result === 'ok') return;
      if (result === 'wrong') {
        setError(t('appLock.wrongCode', { count: useAppLockStore.getState().attemptsLeft }));
        return;
      }
      if (result === 'signed-out') {
        Alert.alert(t('appLock.tooManyTitle'), t('appLock.tooManyBody'));
      }
    },
    [unlockWithPin, t],
  );

  const onDigit = (digit: string) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    setError(null);
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  };

  const forgot = () => {
    Alert.alert(t('appLock.forgotTitle'), t('appLock.forgotBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('appLock.forgotAction'),
        style: 'destructive',
        onPress: () => {
          setLeaving(true);
          const { deviceId, sessionEpoch } = useAuthStore.getState();
          // Revoke when reachable, always clear locally, and never close a
          // newer session because the old logout answered late.
          void authApi
            .logout(deviceId)
            .catch(() => undefined)
            .then(async () => {
              if (useAuthStore.getState().sessionEpoch === sessionEpoch) await useAuthStore.getState().clear();
            })
            .finally(() => setLeaving(false));
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: color.background }]}>
      <View style={[styles.top, { paddingHorizontal: space[5], paddingTop: space[8] }]}>
        <JakoWingMark size={36} color={color.primary} />
        <Text accessibilityRole="header" style={[text.title, { color: color.textPrimary, marginTop: space[5] }]}>
          {t('appLock.enterTitle')}
        </Text>
        <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[2], textAlign: 'center' }]}>
          {t('appLock.enterSubtitle')}
        </Text>
        <Text
          accessibilityRole={error ? 'alert' : undefined}
          style={[text.bodySm, styles.error, { color: color.dangerText, marginTop: space[4], minHeight: 20 }]}
        >
          {error ?? (attemptsLeft < MAX_VISIBLE_HINT ? t('appLock.attemptsLeft', { count: attemptsLeft }) : '')}
        </Text>
      </View>
      <View style={{ paddingBottom: space[6] }}>
        <PinPad
          value={pin}
          onDigit={onDigit}
          onBackspace={() => setPin((p) => p.slice(0, -1))}
          onBiometric={biometricsEnabled ? tryBiometrics : undefined}
          biometricKind={biometricKind}
          biometricLabel={biometricLabel}
          disabled={busy || leaving}
          error={!!error}
        />
        <Pressable onPress={forgot} disabled={leaving} hitSlop={8} style={{ alignSelf: 'center', marginTop: space[6] }}>
          <Text style={[text.bodySm, { color: color.textSecondary }]}>{t('appLock.forgot')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** Below this many tries left, the hint shows even before a wrong code. */
const MAX_VISIBLE_HINT = 3;

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between' },
  top: { alignItems: 'center' },
  error: { textAlign: 'center' },
});
