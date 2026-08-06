import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { authApi } from '../../../data/api/authApi';
import { useAuthStore } from '../../../data/stores/authStore';
import type { AuthStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export function RegisterScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { theme, spacing, typography } = useAppTheme();
  const { deviceId, setSession } = useAuthStore();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('+374');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setLoading(true);
    try {
      const result = await authApi.register({
        firstName,
        lastName,
        phone,
        password,
        locale: i18n.language,
        referralCode: referralCode || undefined,
        deviceId,
      });
      await setSession(result.user, result.tokens);
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={[typography.largeTitle, { color: theme.textPrimary, marginBottom: spacing.lg }]}>
        {t('auth.createAccount')}
      </Text>

      <TextField label={t('auth.firstName')} value={firstName} onChangeText={setFirstName} />
      <TextField label={t('auth.lastName')} value={lastName} onChangeText={setLastName} />
      <TextField label={t('auth.phoneNumber')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <TextField label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry />
      <TextField
        label={t('auth.referralCodeOptional')}
        value={referralCode}
        onChangeText={setReferralCode}
        autoCapitalize="characters"
      />

      <Button label={t('auth.registerButton')} onPress={handleRegister} loading={loading} />

      <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
        <Button label={t('auth.login')} variant="ghost" onPress={() => navigation.navigate('Login')} />
      </View>
    </ScreenContainer>
  );
}
