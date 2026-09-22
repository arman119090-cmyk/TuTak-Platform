import React from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../app/theme/ThemeProvider';
import { useAppLockStore } from '../../data/stores/appLockStore';
import { useBiometricLabel } from '../screens/appLock/useBiometricLabel';
import { ListRow } from './ListRow';
import type { RootStackParamList } from '../../app/navigation/types';

/**
 * The two Security rows the lock adds: change the code, and the biometric
 * switch. The switch is only drawn when the phone has a strong biometric
 * enrolled — a switch that could never turn on is a broken switch.
 */
export function AppLockSettings() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { biometricKind, biometricsEnabled, busy, enableBiometrics, disableBiometrics } = useAppLockStore();
  const label = useBiometricLabel(biometricKind);

  const toggle = (next: boolean) => {
    if (!next) {
      void disableBiometrics();
      return;
    }
    void enableBiometrics(t('appLock.biometricPrompt')).then((ok) => {
      if (!ok) Alert.alert(label, t('appLock.biometricNotEnabled'));
    });
  };

  return (
    <>
      <ListRow
        title={t('appLock.changeCode')}
        leading={<RowIcon name="keypad-outline" />}
        trailing={<Ionicons name="chevron-forward" size={18} color={color.borderStrong} />}
        onPress={() => navigation.navigate('ChangePin')}
      />
      {biometricKind || biometricsEnabled ? (
        <View style={[styles.row, { paddingVertical: space[3], gap: space[4] }]}>
          <RowIcon name={biometricKind === 'face' ? 'scan-outline' : 'finger-print-outline'} />
          <View style={styles.flex}>
            <Text style={[text.body, { color: color.textPrimary }]}>{t('appLock.biometricRow', { method: label })}</Text>
            <Text style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}>
              {t('appLock.biometricExplain')}
            </Text>
          </View>
          <Switch
            accessibilityLabel={label}
            value={biometricsEnabled}
            onValueChange={toggle}
            disabled={busy}
            trackColor={{ true: color.primary, false: color.borderStrong }}
            thumbColor="#FFFFFF"
          />
        </View>
      ) : null}
    </>
  );
}

function RowIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  const { color } = useTheme();
  return (
    <View style={styles.icon}>
      <Ionicons name={name} size={22} color={color.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
