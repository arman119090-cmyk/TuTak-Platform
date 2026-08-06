import React from 'react';
import { FlatList, Share, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { ReferralInviteDto } from '@tutak/shared-types';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { referralApi } from '../../../data/api/referralApi';

function InviteRow({ invite }: { invite: ReferralInviteDto }) {
  const { theme, spacing, typography } = useAppTheme();
  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[typography.callout, { color: theme.textPrimary }]}>{invite.status}</Text>
        {invite.rewardAmount ? (
          <Text style={[typography.headline, { color: theme.bonusAvailable }]}>+{invite.rewardAmount}</Text>
        ) : null}
      </View>
    </Card>
  );
}

export function ReferralScreen() {
  const { t } = useTranslation();
  const { theme, spacing, typography } = useAppTheme();
  const { data: code } = useQuery({ queryKey: ['referral-code'], queryFn: referralApi.getMyCode });
  const { data: invites } = useQuery({ queryKey: ['referral-invites'], queryFn: referralApi.listMyInvites });

  const handleShare = () => {
    if (!code) return;
    Share.share({ message: `${t('referral.yourCode')}: ${code.code}` });
  };

  return (
    <ScreenContainer scroll={false}>
      <Text style={[typography.title1, { color: theme.textPrimary, marginBottom: spacing.md }]}>
        {t('referral.inviteFriends')}
      </Text>
      <Card style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <Text style={[typography.footnote, { color: theme.textSecondary }]}>{t('referral.yourCode')}</Text>
        <Text style={[typography.largeTitle, { color: theme.primary, marginVertical: spacing.sm }]}>
          {code?.code ?? '—'}
        </Text>
        <Button label={t('referral.shareCode')} onPress={handleShare} />
      </Card>
      <FlatList
        data={invites ?? []}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <InviteRow invite={item} />}
      />
    </ScreenContainer>
  );
}
