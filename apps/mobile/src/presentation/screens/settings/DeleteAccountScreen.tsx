import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { authApi } from '../../../data/api/authApi';
import { describeApiError } from '../../../data/api/errors';
import { useAuthStore } from '../../../data/stores/authStore';
import { walletApi } from '../../../data/api/walletApi';
import type { RootStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'DeleteAccount'>;

/**
 * Deleting an account, said plainly.
 *
 * Both app stores require this to exist inside the app, and both of them are
 * really requiring a specific quality of it: that the customer understands
 * what happens before it happens. So this screen states the four consequences
 * as facts rather than burying them in a paragraph, shows the points balance
 * that is about to be forfeited, and asks for the password — which is a real
 * check on the server, not a confirmation ritual.
 *
 * The two-stage nature of the deletion is disclosed rather than smoothed
 * over. Access ends now; the personal data is erased after a window the
 * server names in its response. Telling someone only the first half would be
 * the kind of half-truth this screen exists to avoid.
 */
export function DeleteAccountScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const { clear } = useAuthStore();
  // Shown because forfeiting points is the consequence a customer is most
  // likely to have not thought about, and a number is more honest than the
  // word "any".
  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: walletApi.getMyWallet });

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const receipt = await authApi.deleteAccount({ password });
      const erasedOn = new Date(receipt.anonymizedAfter).toLocaleDateString();
      // Sign out from the alert's callback rather than immediately: clearing
      // the store unmounts this screen, and an alert raised from an unmounted
      // component is never seen.
      Alert.alert(t('settings.deleteAccountDoneTitle'), t('settings.deleteAccountDoneBody', { date: erasedOn }), [
        { text: t('common.ok'), onPress: () => void clear() },
      ]);
    } catch (err) {
      // The server refuses for reasons the customer can act on — a running
      // charging session, a payment mid-flight, a partner role — so its
      // message is shown rather than a generic failure.
      setError(describeApiError(err) ?? t('settings.deleteAccountFailed'));
      setLoading(false);
    }
  };

  const confirm = () => {
    Alert.alert(t('settings.deleteAccountConfirmTitle'), t('settings.deleteAccountConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.deleteAccount'), style: 'destructive', onPress: () => void submit() },
    ]);
  };

  return (
      <Screen title={t('settings.deleteAccount')}>
        <Surface>
          <View style={styles.heading}>
            <View
              style={[
                styles.warnIcon,
                { backgroundColor: color.dangerSurface, borderRadius: radius.md },
              ]}
            >
              <Ionicons name="warning-outline" size={20} color={color.dangerText} />
            </View>
            <Text style={[text.headline, { color: color.textPrimary, marginLeft: space[3] }]}>
              {t('settings.deleteAccountHeading')}
            </Text>
          </View>

          <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[4] }]}>
            {t('settings.deleteAccountIntro')}
          </Text>

          <View style={{ marginTop: space[4] }}>
            <Consequence text={t('settings.deleteAccountPointAccess')} />
            <Consequence
              text={t('settings.deleteAccountPointBonus', { amount: wallet?.availableBonus ?? '0' })}
            />
            <Consequence text={t('settings.deleteAccountPointData')} />
            {/* Not a caveat hidden at the bottom: the customer is entitled to
                know the financial history is kept, and why. */}
            <Consequence text={t('settings.deleteAccountPointLedger')} />
          </View>
        </Surface>

        <View style={{ marginTop: space[5] }}>
          <TextField
            label={t('auth.currentPassword')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            hint={t('settings.deleteAccountPasswordHint')}
            error={error ?? undefined}
          />
        </View>

        <Button
          label={t('settings.deleteAccount')}
          onPress={confirm}
          loading={loading}
          disabled={password.length === 0 || loading}
          variant="destructive"
        />

        <View style={{ marginTop: space[3] }}>
          <Button
            label={t('common.cancel')}
            onPress={() => navigation.goBack()}
            variant="tertiary"
            disabled={loading}
          />
        </View>
      </Screen>
  );
}

function Consequence({ text: line }: { text: string }) {
  const { color, space, text } = useTheme();
  return (
    <View style={[styles.consequence, { marginTop: space[3] }]}>
      <Ionicons name="ellipse" size={6} color={color.textTertiary} style={{ marginTop: 7 }} />
      <Text style={[text.bodySm, { color: color.textSecondary, marginLeft: space[3], flex: 1 }]}>
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { flexDirection: 'row', alignItems: 'center' },
  warnIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  consequence: { flexDirection: 'row', alignItems: 'flex-start' },
});
