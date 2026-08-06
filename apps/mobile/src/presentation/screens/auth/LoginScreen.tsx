import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { MascotBadge } from '../../components/MascotBadge';
import { ScreenContainer } from '../../components/ScreenContainer';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { authApi } from '../../../data/api/authApi';
import { useAuthStore } from '../../../data/stores/authStore';
import type { AuthStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { theme, spacing, typography } = useAppTheme();
  const { deviceId, setSession } = useAuthStore();
  const [phone, setPhone] = useState('+374');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const result = await authApi.login({ phone, password, deviceId });
      await setSession(result.user, result.tokens);
    } catch (err) {
      Alert.alert(t('common.error'), t('auth.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
        <MascotBadge size={72} />
        <Text style={[typography.largeTitle, { color: theme.textPrimary, marginTop: spacing.md }]}>
          {t('auth.welcomeBack')}
        </Text>
      </View>

      <TextField
        label={t('auth.phoneNumber')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoCapitalize="none"
      />
      <TextField
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Button label={t('auth.loginButton')} onPress={handleLogin} loading={loading} />

      <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
        <Button
          label={t('auth.createAccount')}
          variant="ghost"
          onPress={() => navigation.navigate('Register')}
        />
      </View>
    </ScreenContainer>
  );
}
