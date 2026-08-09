import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { authApi } from '../../../data/api/authApi';
import { describeApiError } from '../../../data/api/errors';
import type { RootStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ChangePassword'>;

/**
 * Changing a password revokes every refresh token the account holds, so this
 * screen ends by sending the user back rather than leaving them on a screen
 * whose session the server just killed.
 */
export function ChangePasswordScreen({ navigation }: Props) {
  const { t } = useTranslation();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      Alert.alert(t('auth.passwordChangedTitle'), t('auth.passwordChangedBody'), [
        { text: t('common.ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      setError(describeApiError(err) ?? t('auth.changePasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && !loading;

  return (
      <Screen title={t('settings.changePassword')}>
        <TextField
          label={t('auth.currentPassword')}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          placeholder="••••••••"
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
          label={t('settings.changePassword')}
          onPress={handleSubmit}
          loading={loading}
          disabled={!canSubmit}
        />
      </Screen>
  );
}
