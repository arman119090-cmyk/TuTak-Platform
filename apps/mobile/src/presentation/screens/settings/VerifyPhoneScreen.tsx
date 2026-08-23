import React, { useState } from 'react';
import { Alert, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { JakoWingMark } from '../../components/V2NavIcon';
import { authApi } from '../../../data/api/authApi';
import { describeApiError } from '../../../data/api/errors';
import { useAuthStore } from '../../../data/stores/authStore';
import type { RootStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyPhone'>;

/**
 * Gates bonus *earning*, not spending — an unverified account can still pay
 * and charge, so this screen is reachable at any time rather than blocking
 * the rest of the app.
 */
export function VerifyPhoneScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const { user, setSession, refreshToken, accessToken } = useAuthStore();

  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleSendCode = async () => {
    setError(null);
    setSending(true);
    try {
      await authApi.requestPhoneVerification();
      setCodeSent(true);
    } catch (err) {
      setError(describeApiError(err) ?? t('auth.sendCodeFailed'));
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async () => {
    setError(null);
    setConfirming(true);
    try {
      await authApi.confirmPhoneVerification({ code });
      // The tokens are unaffected; only the verified flag on the cached user changes.
      if (user && accessToken && refreshToken) {
        await setSession(
          { ...user, isPhoneVerified: true },
          {
            accessToken,
            refreshToken,
            accessTokenExpiresAt: '',
            refreshTokenExpiresAt: '',
          },
        );
      }
      Alert.alert(t('auth.phoneVerifiedTitle'), t('auth.phoneVerifiedBody'), [
        { text: t('common.ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      setError(describeApiError(err) ?? t('auth.confirmCodeFailed'));
    } finally {
      setConfirming(false);
    }
  };

  if (user?.isPhoneVerified) {
    return (
      <Screen title={t('auth.otpTitle')}>
        <Text style={[text.body, { color: color.textSecondary, marginTop: space[4] }]}>
          {t('auth.phoneAlreadyVerified')}
        </Text>
      </Screen>
    );
  }

  return (
      <Screen title={t('auth.otpTitle')} subtitle={t('auth.verifyPhoneSubtitle', { phone: user?.phone })}>
        {!codeSent ? (
          <Button
            label={t('auth.sendVerificationCode')}
            onPress={handleSendCode}
            loading={sending}
            icon={<JakoWingMark size={16} color={color.textInverse} />}
          />
        ) : (
          <>
            <TextField
              label={t('auth.resetCode')}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              maxLength={6}
              error={error ?? undefined}
            />
            <Button
              label={t('auth.confirmCode')}
              onPress={handleConfirm}
              loading={confirming}
              disabled={code.length !== 6 || confirming}
              icon={<JakoWingMark size={16} color={color.textInverse} />}
            />
            <Button
              label={t('auth.resendCode')}
              onPress={handleSendCode}
              variant="tertiary"
              icon={<JakoWingMark size={16} color={color.textBrand} />}
              loading={sending}
            />
          </>
        )}
      </Screen>
  );
}
