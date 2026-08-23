import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { ListRow } from '../../components/ListRow';
import { PartnerMark } from '../../components/PartnerMark';
import { JakoWingMark } from '../../components/V2NavIcon';
import { TileMap } from '../../components/map/TileMap';
import { CATEGORY_ICONS, formatDistance } from './categories';
import { PartnerPin } from './PartnerPin';

type Route = RouteProp<RootStackParamList, 'PartnerDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Opened by a tap on the partner's pin on the map (`PartnersScreen`) — per
 * Arman's explicit request, 2026-08-23, that a location on the map open the
 * partner's own page rather than only scroll to and expand its card in the
 * list below (which a station pin still does; this screen is partner-only).
 *
 * The logo is the partner's own published one, from `NearbyPartnerDto.logo`
 * (`TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §1.3/§4) — the display derivative rather
 * than the thumbnail, since it is rendered at 72pt here against 40pt in the
 * list. A partner that has published none falls back to `PartnerMark`'s
 * neutral mark, which is what every partner predating the media system shows.
 */
export function PartnerDetailScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { partner } = params;

  return (
    <Screen title={partner.name} subtitle={partner.branchName}>
      <Surface style={{ alignItems: 'center', paddingVertical: space[6] }}>
        <PartnerMark name={partner.name} logoUrl={partner.logo?.url} size={72} />
        <View style={[styles.categoryRow, { marginTop: space[3] }]}>
          <Ionicons name={CATEGORY_ICONS[partner.category]} size={14} color={color.textSecondary} />
          <Text style={[text.caption, { color: color.textSecondary, marginLeft: space[1] }]}>
            {t(`partnerCategory.${partner.category}`)}
          </Text>
        </View>
      </Surface>

      <View style={[styles.statsRow, { marginTop: space[3], gap: space[3] }]}>
        <Surface style={{ flex: 1, alignItems: 'center', paddingVertical: space[4] }}>
          <Text style={[text.caption, { color: color.textSecondary }]}>{t('partners.cashback')}</Text>
          <Text style={[text.titleLg, { color: color.availableText, marginTop: space[1] }]}>
            {partner.cashbackPercent}%
          </Text>
        </Surface>
        <Surface style={{ flex: 1, alignItems: 'center', paddingVertical: space[4] }}>
          <Text style={[text.caption, { color: color.textSecondary }]}>{t('partners.distance')}</Text>
          <Text style={[text.titleLg, { color: color.textPrimary, marginTop: space[1] }]}>
            {formatDistance(partner.distanceKm)}
          </Text>
        </Surface>
      </View>

      <View style={{ marginTop: space[3] }}>
        <TileMap
          markers={[
            {
              id: partner.id,
              position: { lat: partner.latitude, lng: partner.longitude },
              render: () => (
                <PartnerPin category={partner.category} cashbackPercent={partner.cashbackPercent} selected />
              ),
            },
          ]}
          initialCentre={{ lat: partner.latitude, lng: partner.longitude }}
          initialZoom={16}
          height={180}
        />
      </View>

      <Surface style={{ marginTop: space[3] }}>
        <ListRow
          title={t('partners.address')}
          subtitle={`${partner.address}, ${partner.city}`}
          leading={<InfoIcon name="location-outline" />}
          last
        />
      </Surface>

      <Text
        style={[text.bodySm, { color: color.textSecondary, textAlign: 'center', marginTop: space[4] }]}
      >
        {t('partners.howToEarn', { percent: partner.cashbackPercent })}
      </Text>

      <View style={{ marginTop: space[4] }}>
        <Button
          label={t('purchaseIntent.payHere')}
          onPress={() =>
            navigation.navigate('CreatePurchaseIntent', {
              partnerId: partner.partnerId,
              partnerBranchId: partner.id,
              partnerName: partner.name,
            })
          }
          icon={<JakoWingMark size={16} color={color.textInverse} />}
        />
      </View>
    </Screen>
  );
}

/** Same leading-icon bubble `SettingsScreen` rows use, so a detail row here
 * reads the same as everywhere else in the app. */
function InfoIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  const { color, radius } = useTheme();
  return (
    <View style={[styles.infoIcon, { backgroundColor: color.surfaceSunken, borderRadius: radius.md }]}>
      <Ionicons name={name} size={18} color={color.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  categoryRow: { flexDirection: 'row', alignItems: 'center' },
  statsRow: { flexDirection: 'row' },
  infoIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
