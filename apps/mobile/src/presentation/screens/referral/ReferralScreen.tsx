import React from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { ListRow } from '../../components/ListRow';
import { StatePill } from '../../components/StatePill';
import { SectionHeader } from '../../components/SectionHeader';
import { EmptyState } from '../../components/EmptyState';
import { JakoWatermark } from '../../components/Jako';
import { referralApi } from '../../../data/api/referralApi';
import { formatDate, formatPoints } from '../../utils/format';

export function ReferralScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius, palette } = useTheme();

  const { data: code } = useQuery({ queryKey: ['referral-code'], queryFn: referralApi.getMyCode });
  const { data: invites } = useQuery({
    queryKey: ['referral-invites'],
    queryFn: referralApi.listMyInvites,
  });

  const list = invites ?? [];
  const rewarded = list.filter((i) => i.status === 'REWARDED');
  const totalEarned = rewarded.reduce((s, i) => s + Number(i.rewardAmount ?? 0), 0);

  const handleShare = () => {
    if (!code) return;
    Share.share({ message: t('referral.shareMessage', { code: code.code }) });
  };

  return (
    <Screen title={t('referral.inviteFriends')} subtitle={t('referral.subtitle')}>
      {/* The code is the point of the screen, so it gets the brand surface. */}
      <View
        style={[
          styles.codeCard,
          { backgroundColor: palette.brand[600], borderRadius: radius['2xl'], padding: space[6] },
        ]}
      >
        <View style={styles.watermark} pointerEvents="none">
          <JakoWatermark size={200} color={color.textInverse} opacity={0.07} />
        </View>

        <Text style={[text.caption, { color: 'rgba(255,255,255,0.72)' }]}>
          {t('referral.yourCode')}
        </Text>
        <Text
          style={[
            text.balanceSm,
            { color: color.textInverse, marginTop: space[2], letterSpacing: 1 },
          ]}
        >
          {code?.code ?? '—'}
        </Text>

        <View style={{ marginTop: space[5] }}>
          <Button
            label={t('referral.shareCode')}
            onPress={handleShare}
            variant="secondary"
            icon={<Ionicons name="share-outline" size={18} color={color.primary} />}
          />
        </View>
      </View>

      <View style={[styles.stats, { marginTop: space[5], gap: space[3] }]}>
        <Surface style={styles.flex}>
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('referral.totalInvites')}
          </Text>
          <Text style={[text.title, { color: color.textPrimary, marginTop: space[1] }]}>
            {list.length}
          </Text>
        </Surface>
        <Surface style={styles.flex}>
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('referral.rewardEarned')}
          </Text>
          <Text style={[text.title, { color: color.availableText, marginTop: space[1] }]}>
            {formatPoints(totalEarned)}
          </Text>
        </Surface>
      </View>

      <SectionHeader title={t('referral.yourInvites')} />
      <Surface padded={false}>
        <View style={{ paddingHorizontal: space[5] }}>
          {list.length === 0 ? (
            <EmptyState title={t('referral.noInvitesTitle')} message={t('referral.noInvitesMessage')} />
          ) : (
            list.map((invite, i) => (
              <ListRow
                key={invite.id}
                title={t(`referralStatus.${invite.status}`, { defaultValue: invite.status })}
                subtitle={formatDate(invite.createdAt)}
                value={invite.rewardAmount ? `+${formatPoints(invite.rewardAmount)}` : undefined}
                valueTone="positive"
                trailing={
                  invite.status === 'PENDING' ? <StatePill state="pending" /> : undefined
                }
                last={i === list.length - 1}
              />
            ))
          )}
        </View>
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  codeCard: { overflow: 'hidden', position: 'relative' },
  watermark: { position: 'absolute', right: -50, top: -40 },
  stats: { flexDirection: 'row' },
});
