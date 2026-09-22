import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { TextField } from '../../components/TextField';
import { usePasswordReveal } from '../../components/usePasswordReveal';
import { Button } from '../../components/Button';
import { JakoWingMark } from '../../components/V2NavIcon';
import { authApi } from '../../../data/api/authApi';
import { describeApiError } from '../../../data/api/errors';
import type { AuthStackParamList } from '../../../app/navigation/types';
import { JakoScene } from '../../components/JakoScene';
import { DataSafeNote } from '../../components/DataSafeNote';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

/** The reset code is a fixed 6-digit challenge tied to the phone the previous screen requested it for. */
export function ResetPasswordScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { color } = useTheme();
  const { phone } = route.params;

  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const reveal = usePasswordReveal();
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
    <JakoScene
      state="password"
      title={t('auth.resetPasswordTitle')}
      subtitle={t('auth.otpSubtitle', { phone })}
      note={t('scene.note.password')}
      bubble={t('scene.bubble')}
    >
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
            secureTextEntry={reveal.secureTextEntry}
            revealToggle={reveal.revealToggle}
            placeholder="••••••••"
            hint={t('auth.passwordHint')}
            error={error ?? undefined}
          />

          <Button
            label={t('auth.resetPasswordButton')}
            onPress={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
            icon={<JakoWingMark size={16} color={color.textInverse} />}
          />
          <DataSafeNote />
    </JakoScene>
  );
}
