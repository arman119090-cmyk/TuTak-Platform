import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../app/theme/ThemeProvider';
import { Surface } from './Surface';
import { V2NavIcon, JakoWingMark } from './V2NavIcon';
import { referralApi } from '../../data/api/referralApi';

/**
 * Master spec §1 (Home): "The referral entry sits immediately after the
 * quick actions — before long transaction history — because it is a
 * primary acquisition loop. It contains: `Пригласить друзей`, a short
 * truthful benefit such as `Сеть до 3 уровней`, the number of personally
 * invited friends when known, and a direct route to `Моя сеть`. Do not show
 * a made-up earned amount or downline count."
 *
 * Only the personally-invited (Level-1) count is shown here — the same
 * `/referral/me/invites` list `ReferralScreen` renders as identities, just
 * counted. There is no L2/L3 figure on this card: those are aggregate-only
 * and, in this delivery, not available from any endpoint at all (see
 * `ReferralScreen`'s own "not available yet" state) — showing a number for
 * them here would be exactly the "made-up downline count" the spec forbids.
 */
export function ReferralEntryCard({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();

  const { data: invites } = useQuery({
    queryKey: ['referral-invites'],
    queryFn: referralApi.listMyInvites,
  });

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('referral.inviteFriends')}>
      <Surface>
        <View style={styles.row}>
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: color.primarySurface, borderRadius: radius.md },
            ]}
          >
            <V2NavIcon name="referralNetwork" size={24} color={color.primary} />
          </View>

          <View style={[styles.flex, { marginLeft: space[3] }]}>
            <Text style={[text.headline, { color: color.textPrimary }]}>
              {t('referral.inviteFriends')}
            </Text>
            <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[1] }]}>
              {t('referral.networkBenefit')}
              {invites ? ` · ${t('referral.totalInvites')}: ${invites.length}` : ''}
            </Text>
          </View>

          <View
            style={[
              styles.cta,
              { backgroundColor: color.primary, borderRadius: radius.full, gap: space[1] },
            ]}
          >
            {/* Safe positive CTA — the Jako wing signature is permitted here
                per the master spec's icon-boundary table; the localized
                label stays the accessible name, the mark is reinforcement
                only. */}
            <JakoWingMark size={14} color={color.textInverse} />
            <Text style={[text.label, { color: color.textInverse }]}>
              {t('referral.openMyNetwork')}
            </Text>
          </View>
        </View>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  iconWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
