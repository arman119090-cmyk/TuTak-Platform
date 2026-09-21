import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { JakoWingMark } from '../../components/V2NavIcon';
import { authApi } from '../../../data/api/authApi';
import type { AuthStackParamList } from '../../../app/navigation/types';
import { JakoScene } from '../../components/JakoScene';
import { DataSafeNote } from '../../components/DataSafeNote';
import { localPhoneDigits } from '../../../domain/phone';

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
  const { color } = useTheme();

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
    <JakoScene
      state="reset-password"
      title={t('auth.forgotPasswordTitle')}
      subtitle={t('auth.forgotPasswordSubtitle')}
      note={t('scene.note.reset')}
      bubble={t('scene.bubble')}
    >
          <TextField
            label={t('auth.phoneNumber')}
            prefix="+374"
            value={phone}
            onChangeText={(v) => setPhone(localPhoneDigits(v))}
            keyboardType="number-pad"
            placeholder="00 000 000"
            maxLength={8}
            error={error ?? undefined}
          />

          <Button
            label={t('auth.sendResetCode')}
            onPress={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
            icon={<JakoWingMark size={16} color={color.textInverse} />}
          />
          <DataSafeNote />
    </JakoScene>
  );
}
