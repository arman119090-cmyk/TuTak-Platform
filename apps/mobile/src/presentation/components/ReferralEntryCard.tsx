import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../app/theme/ThemeProvider';
import { Surface } from './Surface';
import { V2NavIcon } from './V2NavIcon';
import { referralApi } from '../../data/api/referralApi';

/**
 * Master spec §1 (Home): the referral entry sits after the quick actions,
 * before the transaction history, and shows the personally-invited count
 * when known — never a made-up earned amount or downline figure. Only the
 * Level-1 count is shown (see `ReferralScreen` for why L2/L3 are not).
 *
 * Visually it is now one quiet row on a grey group, not a card with its own
 * CTA pill: the whole row is the button, the chevron says so, and the icon
 * is the same Jako family as the tab bar. It should read as part of Home,
 * not as an advert placed on it.
 */
export function ReferralEntryCard({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { color, space, text, radius, palette } = useTheme();

  const { data: invites } = useQuery({
    queryKey: ['referral-invites'],
    queryFn: referralApi.listMyInvites,
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('referral.inviteFriends')}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <Surface tone="subtle" padded={false}>
        <View style={[styles.row, { padding: space[4], gap: space[3] }]}>
          <View style={[styles.iconWrap, { backgroundColor: color.surface, borderRadius: radius.md }]}>
            <V2NavIcon name="referralNetwork" size={26} color={color.primary} strokeWidth={2.6} />
          </View>

          <View style={styles.flex}>
            <Text style={[text.headline, { color: color.textPrimary }]}>
              {t('referral.inviteFriends')}
            </Text>
            <Text style={[text.caption, { color: color.textSecondary, marginTop: 2 }]} numberOfLines={2}>
              {t('referral.networkBenefit')}
              {invites ? ` · ${t('referral.totalInvites')}: ${invites.length}` : ''}
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={18} color={palette.neutral[400]} />
        </View>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  iconWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
