import React, { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScroll } from '../../components/KeyboardAwareScroll';
import { BackButton } from '../../components/BackButton';
import { useCompactLayout } from '../../components/useCompactLayout';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { authApi } from '../../../data/api/authApi';
import { describeApiError } from '../../../data/api/errors';
import type { AuthStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

/** The reset code is a fixed 6-digit challenge tied to the phone the previous screen requested it for. */
export function ResetPasswordScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { color, space, text, layout } = useTheme();
  const compact = useCompactLayout();
  const { phone } = route.params;

  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await authApi.confirmPasswordReset({ phone, code, newPassword });
      Alert.alert(t('auth.passwordResetDoneTitle'), t('auth.passwordResetDoneBody'), [
        { text: t('common.ok'), onPress: () => navigation.navigate('Login') },
      ]);
    } catch (err) {
      setError(describeApiError(err) ?? t('auth.resetConfirmFailed'));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = code.length === 6 && newPassword.length >= 8 && !loading;

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: color.background }]}
      edges={['top', 'bottom']}
    >
        <KeyboardAwareScroll
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: layout.screenPaddingX, paddingTop: compact ? space[6] : space[10] },
          ]}
        >
          {/* Every navigator here sets headerShown: false, so this is the
              only way off the screen besides Android's hardware button. */}
          <BackButton />
          <Text style={[text.titleLg, { color: color.textPrimary }]}>
            {t('auth.resetPasswordTitle')}
          </Text>
          <Text
            style={[
              text.bodySm,
              { color: color.textSecondary, marginTop: space[2], marginBottom: compact ? space[5] : space[8] },
            ]}
          >
            {t('auth.otpSubtitle', { phone })}
          </Text>

          <TextField
            label={t('auth.resetCode')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            placeholder="000000"
            maxLength={6}
          />
          <TextField
            label={t('auth.newPassword')}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            placeholder="••••••••"
            hint={t('auth.passwordHint')}
            error={error ?? undefined}
          />

          <Button
            label={t('auth.resetPasswordButton')}
            onPress={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
          />
        </KeyboardAwareScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 40 },
});
