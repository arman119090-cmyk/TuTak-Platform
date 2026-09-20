import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { formatRate } from './CashbackRateField';
import type { RootStackParamList } from '../../../app/navigation/types';
import { JakoHero } from '../../components/JakoHero';

type Props = NativeStackScreenProps<RootStackParamList, 'PartnerApplicationSent'>;

/**
 * What the applicant sees once the application is in.
 *
 * It repeats back what was sent, because this is the last time they will see
 * it: the partner exists now but they have no panel to open until an
 * administrator approves it, so a person who mistyped their shop name has
 * only this screen to notice on.
 *
 * Nothing is fetched here. The figures come through navigation params — they
 * were just accepted by the server a moment ago, and a screen that re-read
 * them could only fail in ways that would worry someone whose application is
 * perfectly fine.
 */
export function PartnerApplicationSentScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const { displayName, category, rateBps, taxId } = route.params;

  return (
    <Screen title={t('partnerApplication.title')}>
      <JakoHero state="partner-submitted" style={{ marginTop: space[2] }} />
      <Text
        style={[
          text.titleLg,
          { color: color.textPrimary, marginTop: space[5], marginBottom: space[3] },
        ]}
      >
        {t('partnerApplication.sentTitle')}
      </Text>

      <Text style={[text.body, { color: color.textSecondary, marginBottom: space[7] }]}>
        {t('partnerApplication.sentBody', { name: displayName })}
      </Text>

      <Surface tone="subtle">
        <Row label={t('becomePartner.displayName')} value={displayName} />
        <Row label={t('becomePartner.category')} value={t(`partnerCategory.${category}`)} divided />
        <Row
          label={t('becomePartner.rate')}
          value={`${formatRate(rateBps)}%`}
          valueColor={color.primary}
          divided
        />
        <Row
          label={t('becomePartner.taxId')}
          value={taxId ?? t('partnerApplication.taxIdMissing')}
          valueColor={taxId ? undefined : color.textTertiary}
          divided
        />
      </Surface>

      {taxId ? null : (
        <Text
          style={[
            text.caption,
            { color: color.textTertiary, marginTop: space[4], textAlign: 'center' },
          ]}
        >
          {t('partnerApplication.taxIdLater')}
        </Text>
      )}

      <View style={{ marginTop: space[7] }}>
        <Button
          label={t('partnerApplication.backHome')}
          variant="secondary"
          onPress={() => navigation.navigate('Main')}
        />
      </View>
    </Screen>
  );
}

function Row({
  label,
  value,
  valueColor,
  divided = false,
}: {
  label: string;
  value: string;
  valueColor?: string;
  divided?: boolean;
}) {
  const { color, space, text } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: space[4],
        paddingVertical: space[3],
        ...(divided ? { borderTopWidth: 1, borderTopColor: color.border } : {}),
      }}
    >
      <Text style={[text.bodySm, { color: color.textSecondary }]}>{label}</Text>
      <Text
        style={[
          text.bodySm,
          { color: valueColor ?? color.textPrimary, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}
