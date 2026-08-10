import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScroll } from '../../components/KeyboardAwareScroll';
import { useCompactLayout } from '../../components/useCompactLayout';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Jako } from '../../components/Jako';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { authApi } from '../../../data/api/authApi';
import { useAuthStore } from '../../../data/stores/authStore';
import type { AuthStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text, layout } = useTheme();
  const compact = useCompactLayout();
  const { deviceId, setSession } = useAuthStore();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * Shown only when the API says it is a demonstration. Asked of the server
   * rather than decided here: the same build aimed at a real API offers no
   * shortcut, so there is nothing to disable before release.
   */
  const [demoAvailable, setDemoAvailable] = useState(false);

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
          {/* Jako appears once, at the top, as the mark — not decoration. */}
          <Jako size={52} />

          <Text style={[text.titleLg, { color: color.textPrimary, marginTop: space[6] }]}>
            {t('auth.welcomeBack')}
          </Text>
          <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[2], marginBottom: compact ? space[5] : space[8] }]}>
            {t('auth.loginSubtitle')}
          </Text>

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
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            error={error ?? undefined}
          />

          <Pressable
            onPress={() => navigation.navigate('ForgotPassword')}
            hitSlop={8}
            style={{ alignSelf: 'flex-end', marginTop: -space[2], marginBottom: space[2] }}
          >
            <Text style={[text.label, { color: color.primary }]}>{t('auth.forgotPassword')}</Text>
          </Pressable>

          <View style={{ marginTop: space[3] }}>
            <Button
              label={t('auth.loginButton')}
              onPress={handleLogin}
              loading={loading}
              disabled={!canSubmit}
            />
          </View>

          {demoAvailable ? (
            <View style={{ marginTop: space[5] }}>
              <Button
                label={t('auth.enterDemo')}
                variant="secondary"
                onPress={handleDemo}
                disabled={loading}
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
            <Pressable onPress={() => navigation.navigate('Register')} hitSlop={8}>
              <Text style={[text.label, { color: color.primary }]}>{t('auth.register')}</Text>
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
