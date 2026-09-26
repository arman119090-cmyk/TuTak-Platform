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
import { JakoWingMark } from '../../components/V2NavIcon';
import { authApi } from '../../../data/api/authApi';
import { describeApiError } from '../../../data/api/errors';
import { useAuthStore } from '../../../data/stores/authStore';
import type { AuthStackParamList } from '../../../app/navigation/types';
import { useMountTrace } from '../../../diagnostics/instanceTrace';
import { useDimensionsTrace } from '../../../diagnostics/useDimensionsTrace';

type Props = NativeStackScreenProps<AuthStackParamList, 'OtpLogin'>;

/**
 * Item 3: the OTP-first sign-in path. Mirrors `ForgotPasswordScreen`'s
 * anti-enumeration stance — `request-otp` always reports success, so a
 * failure here is shown only as a generic error, never "number not found".
 */
export function OtpLoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text, layout } = useTheme();
  const compact = useCompactLayout();
  const { deviceId, setSession } = useAuthStore();

  /*
   * Instrumented like the other two auth screens, and for a reason specific
   * to this one: it shows a *single* field at a time.
   *
   * The fault was being described as focus migrating between two fields, and
   * a capture from this screen killed that framing — one field, `of=1` in the
   * keyboard line, and the field still loses focus about thirty milliseconds
   * after being granted it, with no `REQ blur` anywhere. So the migration is
   * a consequence, not the cause: what actually happens is that a focused
   * input is dropped, and on a two-field screen Android then hands focus to
   * the next focusable, which produces the ping-pong.
   *
   * That makes this screen the cleanest place to test any candidate: no
   * second field to muddy the reading.
   */
  useMountTrace('OtpLogin');
  useDimensionsTrace();

  const [phone, setPhone] = useState('');
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
      await authApi.requestLoginOtp({ phone: fullPhone });
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
      const result = await authApi.verifyLoginOtp({ phone: fullPhone, code, deviceId });
      await setSession(result.user, result.tokens);
    } catch (err) {
      setError(describeApiError(err) ?? t('auth.invalidCredentials'));
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
          { paddingHorizontal: layout.screenPaddingX, paddingTop: compact ? space[6] : space[10] },
        ]}
      >
        <BackButton />
        <Text style={[text.titleLg, { color: color.textPrimary }]}>
          {t('auth.otpLoginTitle')}
        </Text>
        <Text
          style={[
            text.bodySm,
            { color: color.textSecondary, marginTop: space[2], marginBottom: compact ? space[5] : space[8] },
          ]}
        >
          {codeSent ? t('auth.otpRegisterCodeSubtitle', { phone: fullPhone }) : t('auth.otpLoginSubtitle')}
        </Text>

        {!codeSent ? (
          <>
            <TextField
              label={t('auth.phoneNumber')}
              traceId="phone"
              prefix="+374"
              value={phone}
              onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 8))}
              keyboardType="number-pad"
              placeholder="00 000 000"
              maxLength={8}
              error={error ?? undefined}
            />
            <View style={{ marginTop: space[3] }}>
              <Button
                label={t('auth.sendVerificationCode')}
                onPress={handleSendCode}
                loading={sending}
                disabled={!canSend}
                icon={<JakoWingMark size={16} color={color.textInverse} />}
              />
            </View>
          </>
        ) : (
          <>
            <TextField
              label={t('auth.resetCode')}
              traceId="otp"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              maxLength={6}
              error={error ?? undefined}
            />
            <View style={{ marginTop: space[3] }}>
              <Button
                label={t('auth.loginButton')}
                onPress={handleVerify}
                loading={verifying}
                disabled={!canVerify}
                icon={<JakoWingMark size={16} color={color.textInverse} />}
              />
              <Button
                label={t('auth.resendCode')}
                onPress={handleSendCode}
                variant="tertiary"
                loading={sending}
                icon={<JakoWingMark size={16} color={color.textBrand} />}
              />
            </View>
          </>
        )}

        <View style={[styles.footer, { marginTop: space[7], gap: space[1] }]}>
          <Text style={[text.bodySm, { color: color.textSecondary }]}>
            {t('auth.noAccountYet')}
          </Text>
          <Pressable onPress={() => navigation.navigate('OtpRegister')} hitSlop={8}>
            <Text style={[text.label, { color: color.primary }]}>{t('auth.register')}</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => navigation.replace('Login')}
          hitSlop={8}
          style={{ alignSelf: 'center', marginTop: space[3] }}
        >
          <Text style={[text.label, { color: color.textTertiary }]}>
            {t('auth.useEmailPasswordInstead')}
          </Text>
        </Pressable>
      </KeyboardAwareScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 40 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
