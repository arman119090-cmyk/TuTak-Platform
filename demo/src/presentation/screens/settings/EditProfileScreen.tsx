import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { JakoWingMark } from '../../components/V2NavIcon';
import { usersApi } from '../../../data/api/usersApi';
import { describeApiError } from '../../../data/api/errors';
import { useAuthStore } from '../../../data/stores/authStore';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

/**
 * Where a customer writes their own name.
 *
 * `PATCH /users/me` has accepted `firstName`, `lastName` and `email` since it
 * was written, and nothing ever sent them — the app used that route for
 * `locale` alone. So an account registered by SMS kept what the server writes
 * when no name is given: "Customer", with the phone number standing in for a
 * surname. That is the "Привет, Customer" on the home screen, and there was
 * nowhere in the app to correct it.
 *
 * The phone number is shown and cannot be edited. It is the account's
 * identity — the wallet hangs off it — and changing it is a different
 * operation with its own SMS confirmation, not a field on a profile form. It
 * is displayed rather than hidden because a person checking their details
 * expects to see which number they are signed in under.
 */
export function EditProfileScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const user = useAuthStore((s) => s.user);
  const patchUser = useAuthStore((s) => s.patchUser);

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      // The session as it is when the request leaves. Everything after the
      // await runs under whichever session exists then, which need not be
      // this one — see `AvatarControl` for the same guard.
      const sessionEpoch = useAuthStore.getState().sessionEpoch;
      const saved = await usersApi.updateProfile({ firstName, lastName, email });
      return { saved, sessionEpoch };
    },
    onSuccess: ({ saved, sessionEpoch }) => {
      // The server's values, not the ones typed here: it trims, and it is the
      // authority on what was actually stored.
      patchUser({ firstName: saved.firstName, lastName: saved.lastName }, sessionEpoch);
      navigation.goBack();
    },
    onError: (err) => setError(describeApiError(err) ?? t('editProfile.failed')),
  });

  // A name is what this screen is for; an empty one would be a request the
  // server rejects rather than a way to clear the field.
  const canSave = firstName.trim().length > 0 && lastName.trim().length > 0 && !save.isPending;

  return (
    <Screen title={t('editProfile.title')}>
      <Text style={[text.body, { color: color.textSecondary, marginBottom: space[6] }]}>
        {t('editProfile.intro')}
      </Text>

      <TextField
        label={t('editProfile.firstName')}
        value={firstName}
        onChangeText={setFirstName}
        autoCapitalize="words"
        maxLength={50}
      />
      <TextField
        label={t('editProfile.lastName')}
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
        maxLength={50}
      />
      <TextField
        label={t('editProfile.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder={t('editProfile.emailPlaceholder')}
        hint={t('common.optional')}
        error={error ?? undefined}
      />

      <View style={{ marginBottom: space[6] }}>
        <Text style={[text.label, { color: color.textSecondary, marginBottom: space[2] }]}>
          {t('editProfile.phone')}
        </Text>
        <View
          style={{
            minHeight: 54,
            borderWidth: 1,
            borderColor: color.border,
            borderRadius: radius.md,
            backgroundColor: color.surfaceSunken,
            paddingHorizontal: space[4],
            justifyContent: 'center',
          }}
        >
          <Text style={[text.body, { color: color.textSecondary }]}>{user?.phone ?? '—'}</Text>
        </View>
        <Text style={[text.caption, { color: color.textTertiary, marginTop: space[2] }]}>
          {t('editProfile.phoneLocked')}
        </Text>
      </View>

      <Button
        label={t('editProfile.save')}
        onPress={() => {
          setError(null);
          save.mutate();
        }}
        loading={save.isPending}
        disabled={!canSave}
        icon={<JakoWingMark size={16} color={color.textInverse} />}
      />
    </Screen>
  );
}
