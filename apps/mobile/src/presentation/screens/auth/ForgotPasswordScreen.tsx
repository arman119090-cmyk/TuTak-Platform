import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { authApi } from '../../../data/api/authApi';
import type { AuthStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

/**
 * The backend always reports success here, whether or not the number is
 * registered — telling the truth would make this endpoint an
 * account-enumeration oracle. This screen carries that through: it never
 * shows a "number not found" error, only a generic failure for network/rate
 * limit problems.
 */
export function ForgotPasswordScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text, layout } = useTheme();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fullPhone = `+374${phone}`;

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await authApi.requestPasswordReset({ phone: fullPhone });
      navigation.navigate('ResetPassword', { phone: fullPhone });
    } catch {
      setError(t('auth.resetRequestFailed'));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = phone.length === 8 && !loading;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: color.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: layout.screenPaddingX, paddingTop: space[10] },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[text.titleLg, { color: color.textPrimary }]}>
            {t('auth.forgotPasswordTitle')}
          </Text>
          <Text
            style={[
              text.bodySm,
              { color: color.textSecondary, marginTop: space[2], marginBottom: space[8] },
            ]}
          >
            {t('auth.forgotPasswordSubtitle')}
          </Text>

          <TextField
            label={t('auth.phoneNumber')}
            prefix="+374"
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 8))}
            keyboardType="number-pad"
            autoComplete="tel"
            placeholder="00 000 000"
            maxLength={8}
            error={error ?? undefined}
          />

          <Button
            label={t('auth.sendResetCode')}
            onPress={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 40 },
});
