import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { TextField } from '../../components/TextField';
import { usePasswordReveal } from '../../components/usePasswordReveal';
import { Button } from '../../components/Button';
import { JakoWingMark } from '../../components/V2NavIcon';
import { authApi } from '../../../data/api/authApi';
import { useMountTrace } from '../../../diagnostics/instanceTrace';
import { useDimensionsTrace } from '../../../diagnostics/useDimensionsTrace';
import { useAuthStore } from '../../../data/stores/authStore';
import type { AuthStackParamList } from '../../../app/navigation/types';
import { JakoScene } from '../../components/JakoScene';
import { DataSafeNote } from '../../components/DataSafeNote';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const { deviceId, setSession } = useAuthStore();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const reveal = usePasswordReveal();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * Shown only when the API says it is a demonstration. Asked of the server
   * rather than decided here: the same build aimed at a real API offers no
   * shortcut, so there is nothing to disable before release.
   */
  const [demoAvailable, setDemoAvailable] = useState(false);

  /*
   * A mount marker, now numbered and stamped with an instance id.
   *
   * It used to be a bare `mount Login`, to be read as Android recreating the
   * activity if it ever appeared twice. That reading was never safe — a React
   * remount, a surface restart and a fresh JS context all produce a second
   * line, and only the counters in `instanceTrace` separate them. The device
   * log has since settled it for this screen anyway: through the whole fault
   * there is one `mount App`, one `mount Login` and no field unmount at all,
   * so nothing here is being rebuilt while the focus moves.
   */
  useMountTrace('Login');

  // Window against screen, on every change. The pair is what separates the
  // two surviving explanations — see the hook.
  useDimensionsTrace();

  useEffect(() => {
    let cancelled = false;
    authApi.isDemoDeployment().then((yes) => {
      if (!cancelled) setDemoAvailable(yes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDemo = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await authApi.demoSession(deviceId);
      await setSession(result.user, result.tokens);
    } catch {
      setError(t('auth.demoUnavailable'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await authApi.login({ phone: `+374${phone}`, password, deviceId });
      await setSession(result.user, result.tokens);
    } catch {
      setError(t('auth.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = phone.length >= 8 && password.length >= 8 && !loading;

  return (
    <JakoScene
      state="login"
      title={t('auth.welcomeBack')}
      subtitle={t('auth.tagline')}
      note={t('scene.note.login')}
      bubble={t('scene.bubble')}
    >
          <TextField
            label={t('auth.phoneNumber')}
            traceId="phone"
            prefix="+374"
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 8))}
            keyboardType="number-pad"
            placeholder="00 000 000"
            maxLength={8}
          />
          <TextField
            label={t('auth.password')}
            traceId="password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={reveal.secureTextEntry}
            revealToggle={reveal.revealToggle}
            placeholder="••••••••"
            error={error ?? undefined}
          />

          <Pressable
            onPress={() => navigation.navigate('ForgotPassword')}
            hitSlop={8}
            style={({ pressed }) => ({ alignSelf: 'flex-end', marginTop: -space[1], marginBottom: space[3], opacity: pressed ? 0.5 : 1 })}
          >
            <Text style={[text.label, { color: color.primary }]}>{t('auth.forgotPassword')}</Text>
          </Pressable>

          <View style={{ marginTop: space[4] }}>
            <Button
              label={t('auth.loginButton')}
              onPress={handleLogin}
              loading={loading}
              disabled={!canSubmit}
              icon={<JakoWingMark size={16} color={color.textInverse} />}
            />
            <DataSafeNote />
          </View>

          <View style={{ marginTop: space[3] }}>
            <Button
              label={t('auth.useSmsCodeInstead')}
              variant="secondary"
              onPress={() => navigation.replace('OtpLogin')}
              disabled={loading}
              icon={<JakoWingMark size={16} color={color.textPrimary} />}
            />
          </View>

          {demoAvailable ? (
            <View style={{ marginTop: space[5] }}>
              <Button
                label={t('auth.enterDemo')}
                variant="secondary"
                onPress={handleDemo}
                disabled={loading}
                icon={<JakoWingMark size={16} color={color.textPrimary} />}
              />
              <Text
                style={[
                  text.caption,
                  { color: color.textTertiary, marginTop: space[2], textAlign: 'center' },
                ]}
              >
                {t('auth.demoHint')}
              </Text>
            </View>
          ) : null}

          <View style={[styles.footer, { marginTop: space[7], gap: space[1] }]}>
            <Text style={[text.bodySm, { color: color.textSecondary }]}>
              {t('auth.noAccountYet')}
            </Text>
            {/* OTP-first (item 3, GitHub issue #28): a normal new customer
                verifies their phone before ever getting a session — see
                OtpRegisterScreen. Password-first registration
                (RegisterScreen) still exists but is no longer linked from
                the normal flow. */}
            <Pressable onPress={() => navigation.navigate('OtpRegister')} hitSlop={8}>
              <Text style={[text.label, { color: color.primary }]}>{t('auth.register')}</Text>
            </Pressable>
          </View>
    </JakoScene>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
