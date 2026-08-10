import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScroll } from '../../components/KeyboardAwareScroll';
import { useCompactLayout } from '../../components/useCompactLayout';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { authApi } from '../../../data/api/authApi';
import { useAuthStore } from '../../../data/stores/authStore';
import type { AuthStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export function RegisterScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { color, space, text, layout } = useTheme();
  const compact = useCompactLayout();
  const { deviceId, setSession } = useAuthStore();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await authApi.register({
        firstName,
        lastName,
        phone: `+374${phone}`,
        password,
        locale: i18n.language,
        referralCode: referralCode || undefined,
        deviceId,
      });
      await setSession(result.user, result.tokens);
    } catch {
      setError(t('auth.registerFailed'));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    phone.length === 8 &&
    password.length >= 8 &&
    !loading;

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: color.background }]}
      edges={['top', 'bottom']}
    >
        <KeyboardAwareScroll
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: layout.screenPaddingX, paddingTop: space[6] },
          ]}
        >
          <Text style={[text.titleLg, { color: color.textPrimary }]}>
            {t('auth.createAccount')}
          </Text>
          <Text
            style={[
              text.bodySm,
              { color: color.textSecondary, marginTop: space[2], marginBottom: compact ? space[5] : space[8] },
            ]}
          >
            {t('auth.registerSubtitle')}
          </Text>

          <View style={[styles.nameRow, { gap: space[3] }]}>
            <View style={styles.flex}>
              <TextField
                label={t('auth.firstName')}
                value={firstName}
                onChangeText={setFirstName}
                autoComplete="given-name"
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label={t('auth.lastName')}
                value={lastName}
                onChangeText={setLastName}
                autoComplete="family-name"
              />
            </View>
          </View>

          <TextField
            label={t('auth.phoneNumber')}
            prefix="+374"
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 8))}
            keyboardType="number-pad"
            placeholder="00 000 000"
            maxLength={8}
          />
          <TextField
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            hint={t('auth.passwordHint')}
            error={error ?? undefined}
          />
          <TextField
            label={t('auth.referralCodeOptional')}
            value={referralCode}
            onChangeText={(v) => setReferralCode(v.toUpperCase())}
            autoCapitalize="characters"
            placeholder="TT-XXXXXXXX"
          />

          <View style={{ marginTop: space[3] }}>
            <Button
              label={t('auth.registerButton')}
              onPress={handleRegister}
              loading={loading}
              disabled={!canSubmit}
            />
          </View>

          <View style={[styles.footer, { marginTop: space[7], gap: space[1] }]}>
            <Text style={[text.bodySm, { color: color.textSecondary }]}>
              {t('auth.haveAccount')}
            </Text>
            <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
              <Text style={[text.label, { color: color.primary }]}>{t('auth.login')}</Text>
            </Pressable>
          </View>
        </KeyboardAwareScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 40 },
  nameRow: { flexDirection: 'row' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
