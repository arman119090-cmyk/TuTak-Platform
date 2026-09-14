import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { useTheme } from '../../app/theme/ThemeProvider';
import { useBiometricStore } from '../../data/stores/biometricStore';
import { useAuthStore } from '../../data/stores/authStore';
import { authApi } from '../../data/api/authApi';

export function BiometricLockScreen() {
  const { t } = useTranslation();
  const { color, text, space } = useTheme();
  const { unlock, busy } = useBiometricStore();
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.background }}>
      <ScrollView contentContainerStyle={{ padding: space[5] }}>
        <View style={{ paddingVertical: 32, gap: space[5] }}>
          <Text accessibilityRole="header" style={[text.headline, { color: color.textPrimary }]}>{t('biometric.locked')}</Text>
          <Text style={[text.bodySm, { color: color.textSecondary }]}>{t('biometric.unlockExplain')}</Text>
          {failed && <Text accessibilityRole="alert" style={{ color: color.dangerText }}>{t('biometric.failed')}</Text>}
          <Button label={t('biometric.unlock')} loading={busy} disabled={leaving} onPress={() => {
            setFailed(false);
            void unlock(t('biometric.prompt')).then((ok) => setFailed(!ok));
          }} />
          <Button label={t('biometric.otherLogin')} variant="secondary" loading={leaving} onPress={() => {
            setLeaving(true);
            const { deviceId, sessionEpoch } = useAuthStore.getState();
            // Revoke when reachable, always clear locally, and never close a
            // newer session because the old logout response arrived late.
            void authApi.logout(deviceId).catch(() => undefined).then(async () => {
              if (useAuthStore.getState().sessionEpoch === sessionEpoch) await useAuthStore.getState().clear();
            }).catch(() => setFailed(true)).finally(() => setLeaving(false));
          }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
