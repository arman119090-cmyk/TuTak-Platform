import React, { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/theme/ThemeProvider';
import { useBiometricStore } from '../../data/stores/biometricStore';
import { Surface } from './Surface';

export function BiometricSetting() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const { kind, enabled, busy, configure } = useBiometricStore();
  const [confirming, setConfirming] = useState(false);
  if (!kind && !enabled) return null;
  const title = t(`biometric.${kind ?? 'biometric'}`);
  const change = async (next: boolean) => {
    setConfirming(false);
    if (!(await configure(next, t('biometric.prompt')))) Alert.alert(title, t('biometric.notChanged'));
  };
  return (
    <Surface>
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <Text style={[text.bodySm, { color: color.textPrimary, flex: 1 }]}>{title}</Text>
          <Switch accessibilityLabel={title} value={enabled} disabled={busy || confirming}
            onValueChange={(next) => {
              if (!next) { void change(false); return; }
              setConfirming(true);
              Alert.alert(title, t('biometric.consent'), [
                { text: t('common.cancel'), style: 'cancel', onPress: () => setConfirming(false) },
                { text: t('biometric.enable'), onPress: () => { void change(true); } },
              ], { cancelable: true, onDismiss: () => setConfirming(false) });
            }} />
        </View>
        <Text style={[text.caption, { color: color.textSecondary }]}>{t('biometric.explain')}</Text>
      </View>
    </Surface>
  );
}
