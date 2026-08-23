import React from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
import { UserAvatar } from '../../components/UserAvatar';
import { referralApi } from '../../../data/api/referralApi';
import { formatDate, formatPoints } from '../../utils/format';

/**
 * `Моя сеть` — `TUTAK_UI_UX_MASTER_SPEC_V2.md` §6, visual reference
 * `TUTAK_V2_REFERRAL_PREVIEW.svg`. Three-level summary + Level-1 identity
 * list + Level-2/3 aggregate-only privacy boundary.
 *
 * Levels 2 and 3: `/referral/me/code` and `/referral/me/invites` are the
 * only referral endpoints this app has (see `referralApi.ts`) — both are
 * inherently Level-1-only (`listMyInvites` returns rows where the current
 * user is `referrerUserId`, i.e. people *this* user personally invited).
 * There is no L2/L3 aggregate-count endpoint yet — the 3-level engine
 * landed on the API in commits f1ee435..342ec0b as a *settlement* mechanic
 * (`ReferralService.resolveReferralChain`/`computePoolSplit`/
 * `creditChainShares`), not as a customer-facing read endpoint, and this
 * delivery's boundary is visual/media only: `ReferralService` and the
 * pool-split/ledger code are explicitly out of scope here, so no such
 * endpoint was added. Per the master spec's own instruction for exactly
 * this situation ("If a required API response has not yet landed, show a
 * truthful unavailable/loading state... Do not display `0` as an L2/L3
 * count while the... aggregate response is unavailable"), both level cards
 * render a truthful "not available yet" state — never a zero, never a
 * client-side guess from the Level-1 list. See the completion report for
 * the full reconciliation.
 */
export function ReferralScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius, gradients, glow } = useTheme();

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
    <Screen title={t('referral.myNetwork')} subtitle={t('referral.subtitle')}>
      {/* 1. Invitation card — code, copy and native share. */}
      <LinearGradient
        colors={[...gradients.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.codeCard,
          glow.sm.native,
          { borderRadius: radius['2xl'], padding: space[6] },
        ]}
      >
        <View style={styles.watermark} pointerEvents="none">
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require('../../../../assets/logo-mark.png')}
            style={styles.watermarkImage}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
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
            icon={<Ionicons name="share-outline" size={18} color={color.textPrimary} />}
          />
        </View>
      </LinearGradient>

      {/* 2. Three-level summary. */}
      <SectionHeader title={t('referral.myNetwork')} />
      <View style={{ gap: space[3] }}>
        <LevelCard
          title={t('referral.level1Title')}
          description={t('referral.level1Description')}
          rate="10%"
          count={list.length}
        />
        <LevelCard
          title={t('referral.level2Title')}
          description={t('referral.level2Description')}
          rate="5%"
          count={null}
        />
        <LevelCard
          title={t('referral.level3Title')}
          description={t('referral.level3Description')}
          rate="5%"
          count={null}
        />
      </View>

      {/* Rewarded-to-date figure — Level-1 only, from data this screen
          already holds; never a fabricated L2/L3 contribution. */}
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

      {/* 3. Level-1 list — the only level with identities. */}
      <SectionHeader title={t('referral.level1Title')} />
      <Surface padded={false}>
        <View style={{ paddingHorizontal: space[5] }}>
          {list.length === 0 ? (
            <EmptyState title={t('referral.noInvitesTitle')} message={t('referral.level1EmptyMessage')} />
          ) : (
            list.map((invite, i) => (
              <ListRow
                key={invite.id}
                leading={
                  <UserAvatar
                    firstName={invite.referee?.firstName}
                    lastName={invite.referee?.lastName}
                    size={40}
                  />
                }
                title={
                  invite.referee
                    ? `${invite.referee.firstName} ${invite.referee.lastName.slice(0, 1)}.`
                    : t('referral.unknownReferee')
                }
                subtitle={`${t(`referralStatus.${invite.status}`, { defaultValue: invite.status })} · ${formatDate(invite.createdAt)}`}
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

      {/* 4. Levels 2 and 3 — aggregate-only privacy note, once, for both. */}
      <Text
        style={[
          text.caption,
          { color: color.textTertiary, textAlign: 'center', marginTop: space[5], paddingHorizontal: space[5] },
        ]}
      >
        {t('referral.aggregateOnlyNote')}
      </Text>
    </Screen>
  );
}

/**
 * One of the three level cards. `count === null` renders the truthful
 * "not available yet" state (see the screen's own docblock) rather than a
 * zero or a client-computed guess — Levels 2 and 3 in this delivery, and
 * never Level 1, which always has a real count from `listMyInvites`.
 */
function LevelCard({
  title,
  description,
  rate,
  count,
}: {
  title: string;
  description: string;
  rate: string;
  count: number | null;
}) {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();

  return (
    <Surface>
      <View style={styles.levelRow}>
        <View style={styles.flex}>
          <Text style={[text.headline, { color: color.textPrimary }]}>{title}</Text>
          <Text style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}>
            {description}
          </Text>
        </View>
        <View
          style={[
            styles.ratePill,
            { backgroundColor: color.primarySurface, borderRadius: radius.full, paddingHorizontal: space[3] },
          ]}
        >
          <Text style={[text.label, { color: color.primary }]}>{rate}</Text>
        </View>
      </View>

      <View style={{ marginTop: space[3] }}>
        {count === null ? (
          <View
            style={[
              styles.unavailable,
              { backgroundColor: color.surfaceSunken, borderRadius: radius.md, padding: space[3], gap: space[1] },
            ]}
          >
            <Text style={[text.label, { color: color.textSecondary }]}>
              {t('referral.levelUnavailableTitle')}
            </Text>
            <Text style={[text.caption, { color: color.textTertiary }]}>
              {t('referral.levelUnavailableMessage')}
            </Text>
          </View>
        ) : (
          <Text style={[text.title, { color: color.textPrimary }]}>{count}</Text>
        )}
      </View>

      <Text style={[text.caption, { color: color.textTertiary, marginTop: space[2] }]}>
        {t('referral.ratePoolNote')}
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  codeCard: { overflow: 'hidden', position: 'relative' },
  watermark: { position: 'absolute', right: -50, top: -40 },
  watermarkImage: { width: 200, height: 200, opacity: 0.07 },
  stats: { flexDirection: 'row' },
  levelRow: { flexDirection: 'row', alignItems: 'flex-start' },
  ratePill: { paddingVertical: 4, alignSelf: 'flex-start' },
  unavailable: {},
});
