import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { useAuthStore } from '../../../data/stores/authStore';
import type { AuthStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'OtpRegister'>;

/**
 * Item 3 (GitHub issue #28): phone -> SMS code -> account, no password.
 *
 * This is the only normal public customer registration path — LoginScreen's
 * "create account" link comes straight here. A new customer never gets a
 * usable session before verifying the code; `RegisterScreen` (password
 * first) still exists but is not mounted in `AuthNavigator` and nothing
 * links to it any more.
 *
 * Name/email are intentionally not collected here — they're optional and
 * completable later via the profile-update screen — so this stays a
 * two-field, two-stage flow: phone (+ optional referral code), then the
 * code. `PurchaseIntentStatusScreen`'s countdown pattern and
 * `VerifyPhoneScreen`'s single-screen stage switch are the closest existing
 * shapes; this follows both rather than introducing a new one.
 */
export function OtpRegisterScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { color, space, text, layout } = useTheme();
  const compact = useCompactLayout();
  const { deviceId, setSession } = useAuthStore();

  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const fullPhone = `+374${phone}`;

  const handleSendCode = async () => {
    setError(null);
    setSending(true);
    try {
      await authApi.requestRegistrationOtp({ phone: fullPhone });
      setCodeSent(true);
    } catch (err) {
      setError(describeApiError(err) ?? t('auth.sendCodeFailed'));
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    setError(null);
    setVerifying(true);
    try {
      const result = await authApi.verifyRegistrationOtp({
        phone: fullPhone,
        code,
        locale: i18n.language,
        referralCode: referralCode || undefined,
        deviceId,
      });
      await setSession(result.user, result.tokens);
    } catch (err) {
      setError(describeApiError(err) ?? t('auth.confirmCodeFailed'));
    } finally {
      setVerifying(false);
    }
  };

  const canSend = phone.length === 8 && !sending;
  const canVerify = code.length === 6 && !verifying;

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
        <BackButton />
        <Text style={[text.titleLg, { color: color.textPrimary }]}>
          {t('auth.otpRegisterTitle')}
        </Text>
        <Text
          style={[
            text.bodySm,
            { color: color.textSecondary, marginTop: space[2], marginBottom: compact ? space[5] : space[8] },
          ]}
        >
          {codeSent ? t('auth.otpRegisterCodeSubtitle', { phone: fullPhone }) : t('auth.otpRegisterSubtitle')}
        </Text>

        {!codeSent ? (
          <>
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
              label={t('auth.referralCodeOptional')}
              value={referralCode}
              onChangeText={(v) => setReferralCode(v.toUpperCase())}
              autoCapitalize="characters"
              placeholder="TT-XXXXXXXX"
              error={error ?? undefined}
            />
            <View style={{ marginTop: space[3] }}>
              <Button
                label={t('auth.sendVerificationCode')}
                onPress={handleSendCode}
                loading={sending}
                disabled={!canSend}
              />
            </View>
          </>
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
            <View style={{ marginTop: space[3] }}>
              <Button
                label={t('auth.otpRegisterButton')}
                onPress={handleVerify}
                loading={verifying}
                disabled={!canVerify}
              />
              <Button
                label={t('auth.resendCode')}
                onPress={handleSendCode}
                variant="tertiary"
                loading={sending}
              />
            </View>
          </>
        )}

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
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
