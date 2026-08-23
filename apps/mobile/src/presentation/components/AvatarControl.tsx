import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../app/theme/ThemeProvider';
import { useAuthStore } from '../../data/stores/authStore';
import { usersApi } from '../../data/api/usersApi';
import { UserAvatar } from './UserAvatar';
import { Surface } from './Surface';

/**
 * The customer's avatar control — `TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §4:
 * "choose image, preview, save, replace, remove, loading/error state and a
 * short privacy explanation."
 *
 * ## Preview before commit, and never a false success
 *
 * Picking an image shows it immediately as a local preview and puts the
 * screen in a "not saved yet" state. Nothing has been sent at that point, and
 * the UI says so. Only pressing save uploads, and the avatar in the auth
 * store is not updated until the server has answered with a stored asset —
 * the spec is explicit that this "must not falsely show success until the
 * server has stored the derived asset", and the failure it is guarding
 * against is the ordinary optimistic-update pattern: a customer sees their
 * new photo, closes the app, and finds the old one back tomorrow with no
 * explanation.
 *
 * A rejected upload (wrong format, too large, corrupt) surfaces the server's
 * own message rather than a generic one. Those messages are written for the
 * person holding the photograph — "The image is 7.2 MB. The maximum is 5 MB."
 * tells them what to do; "Upload failed" does not.
 *
 * ## The consent switch is separate, and off
 *
 * Uploading a picture of yourself and agreeing to appear in somebody else's
 * list are two different decisions (spec §1.4). Bundling them would make the
 * second something that happened to the customer rather than something they
 * chose, so it is its own control, default off, with the explanation next to
 * it rather than in a policy document.
 */
export function AvatarControl() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const queryClient = useQueryClient();

  /** A locally-picked image that has not been sent anywhere yet. */
  const [pending, setPending] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const savedUrl = user?.avatar?.url ?? null;
  const shown = pending?.uri ?? savedUrl;

  const upload = useMutation({
    mutationFn: async () => {
      if (!pending) throw new Error('nothing to upload');
      return usersApi.uploadAvatar(pending);
    },
    onSuccess: (avatar) => {
      // Only now. The server has the derived asset and has handed back the
      // URL that serves it.
      if (user) setUser({ ...user, avatar });
      setPending(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => setError(messageOf(err, t('profile.avatarUploadFailed'))),
  });

  const remove = useMutation({
    mutationFn: () => usersApi.removeAvatar(),
    onSuccess: () => {
      if (user) setUser({ ...user, avatar: null });
      setPending(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => setError(messageOf(err, t('profile.avatarRemoveFailed'))),
  });

  const consent = useMutation({
    mutationFn: (next: boolean) => usersApi.setAvatarConsent(next),
    onSuccess: (result) => {
      if (user) setUser({ ...user, showAvatarInReferralList: result.showAvatarInReferralList });
    },
    onError: (err) => setError(messageOf(err, t('profile.avatarConsentFailed'))),
  });

  const busy = upload.isPending || remove.isPending;

  const pick = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t('profile.avatarPermissionDenied'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      // Square, because that is the shape every surface renders it in. Doing
      // the crop here means the customer chooses which part of the photo
      // survives rather than the server's centre-crop choosing for them.
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPending({
      uri: asset.uri,
      name: asset.fileName ?? 'avatar.jpg',
      mimeType: asset.mimeType ?? 'image/jpeg',
    });
  };

  return (
    <Surface>
      <View style={styles.row}>
        <View>
          <UserAvatar
            firstName={user?.firstName}
            lastName={user?.lastName}
            avatarUrl={shown}
            size={72}
          />
          {busy ? (
            <View
              style={[
                styles.busyOverlay,
                { borderRadius: radius.full, backgroundColor: color.surfaceSunken },
              ]}
            >
              <ActivityIndicator color={color.primary} />
            </View>
          ) : null}
        </View>

        <View style={[styles.flex, { marginLeft: space[4] }]}>
          <Text style={[text.headline, { color: color.textPrimary }]}>
            {t('profile.avatarTitle')}
          </Text>
          <Text style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}>
            {pending ? t('profile.avatarNotSavedYet') : t('profile.avatarHint')}
          </Text>

          <View style={[styles.actions, { marginTop: space[3], gap: space[2] }]}>
            {pending ? (
              <>
                <MiniButton
                  label={t('profile.avatarSave')}
                  icon="checkmark"
                  tone="primary"
                  disabled={busy}
                  onPress={() => upload.mutate()}
                />
                <MiniButton
                  label={t('common.cancel')}
                  icon="close"
                  disabled={busy}
                  onPress={() => {
                    setPending(null);
                    setError(null);
                  }}
                />
              </>
            ) : (
              <>
                <MiniButton
                  label={savedUrl ? t('profile.avatarReplace') : t('profile.avatarChoose')}
                  icon="image-outline"
                  disabled={busy}
                  onPress={() => void pick()}
                />
                {savedUrl ? (
                  <MiniButton
                    label={t('profile.avatarRemove')}
                    icon="trash-outline"
                    tone="danger"
                    disabled={busy}
                    onPress={() => remove.mutate()}
                  />
                ) : null}
              </>
            )}
          </View>
        </View>
      </View>

      {error ? (
        <Text style={[text.bodySm, { color: color.dangerText, marginTop: space[3] }]}>{error}</Text>
      ) : null}

      <View style={[styles.consentRow, { marginTop: space[5] }]}>
        <View style={styles.flex}>
          <Text style={[text.bodySm, { color: color.textPrimary }]}>
            {t('profile.avatarConsentTitle')}
          </Text>
          <Text style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}>
            {t('profile.avatarConsentExplain')}
          </Text>
        </View>
        <Switch
          value={user?.showAvatarInReferralList ?? false}
          onValueChange={(next) => consent.mutate(next)}
          disabled={consent.isPending}
          trackColor={{ true: color.availableSurface, false: color.surfaceSunken }}
          thumbColor={user?.showAvatarInReferralList ? color.availableText : color.textTertiary}
        />
      </View>

      <Text style={[text.caption, { color: color.textTertiary, marginTop: space[3] }]}>
        {t('profile.avatarPrivacyNote')}
      </Text>
    </Surface>
  );
}

/**
 * A compact inline action. Deliberately not the design system's `Button`,
 * which is a full-width primary CTA carrying the Jako wing — three of those
 * stacked inside a settings card would read as three separate decisions of
 * equal weight, which is not what "replace" and "remove" are.
 */
function MiniButton({
  label,
  icon,
  onPress,
  disabled,
  tone = 'neutral',
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'primary' | 'danger';
}) {
  const { color, space, text, radius } = useTheme();
  const fg =
    tone === 'danger' ? color.dangerText : tone === 'primary' ? color.textInverse : color.textPrimary;
  const bg =
    tone === 'danger'
      ? color.dangerSurface
      : tone === 'primary'
        ? color.primary
        : color.surfaceSunken;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.mini,
        {
          backgroundColor: bg,
          borderRadius: radius.full,
          paddingHorizontal: space[3],
          paddingVertical: space[2],
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={14} color={fg} />
      <Text style={[text.caption, { color: fg, marginLeft: 6 }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The server's own message when there is one.
 *
 * The upload boundary is the one place where the error text *is* the user
 * experience: "The image is 7.2 MB. The maximum is 5 MB." is actionable and
 * "Something went wrong" is not, and the API already writes these for a
 * person rather than for a log.
 */
function messageOf(err: unknown, fallback: string): string {
  const response = (err as { response?: { data?: { message?: unknown } } })?.response;
  const message = response?.data?.message;
  if (typeof message === 'string' && message.length > 0) return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return fallback;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  mini: { flexDirection: 'row', alignItems: 'center' },
  consentRow: { flexDirection: 'row', alignItems: 'center' },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
});
