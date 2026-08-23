import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { NearbyPartnerDto, PartnerOfferingDto } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { ListRow } from '../../components/ListRow';
import { PartnerMark } from '../../components/PartnerMark';
import { JakoWingMark } from '../../components/V2NavIcon';
import { TileMap } from '../../components/map/TileMap';
import { partnersApi } from '../../../data/api/partnersApi';
import { formatAmd } from '../../utils/format';
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
 *
 * `NearbyPartnerDto.cover` (spec §2 "official cover photo/logo" / §5 "3:2
 * partner image") is the wide banner this screen adds on top of that logo.
 * Same approval rule as the logo — null for a partner who never published
 * one, which is every partner today, since no real cover has been supplied
 * (`TUTAK_V2_UI_ASSET_MANIFEST.md`'s "intentional omissions"). Null renders
 * no cover block at all rather than a broken image or an invented one — the
 * centred logo-only card underneath is the honest fallback, not a stand-in
 * photo. `CoverImage` hides itself the same way on a load failure, so a
 * cover URL that 404s degrades to the same logo-only card rather than an
 * empty grey rectangle.
 *
 * The "about" text and offerings list (partner public profile, confirmed
 * with Arman 2026-08-23) live only on `PartnerPublicDto`, not the
 * `NearbyPartnerDto` this screen is opened with — see that DTO's own doc
 * comment for why the nearby/map projection deliberately stays lean. So this
 * screen now also fetches `GET /partners/:id` on mount
 * (`CreatePurchaseIntentScreen`'s exact pattern: the nav-param data renders
 * immediately as a placeholder, the fetched detail replaces only the fields
 * that were never on the nav param). Everything the nav param already carries
 * cheaply — distance, the mini-map coordinate, the logo/cover shown above —
 * keeps reading from `partner`, the trusted `NearbyPartnerDto`; nothing here
 * moves wholesale onto the fetched object.
 */
export function PartnerDetailScreen() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { partner } = params;

  const { data: detail } = useQuery({
    queryKey: ['partner', partner.partnerId],
    queryFn: () => partnersApi.get(partner.partnerId),
  });

  return (
    <Screen title={partner.name} subtitle={partner.branchName}>
      {partner.cover ? (
        <Surface padded={false}>
          <CoverImage url={partner.cover.url} name={partner.name}>
            <LogoBlock partner={partner} size={64} paddingVertical={space[5]} />
          </CoverImage>
        </Surface>
      ) : (
        // Centred on an inner view rather than by `alignItems` on the
        // Surface: `Surface` nests its children under a full-width fill, so
        // alignment set on the outer element centres that fill and leaves the
        // content flush left. Invisible while the mark was a placeholder;
        // obvious the moment a real logo landed in it.
        <Surface style={{ paddingVertical: space[6] }}>
          <LogoBlock partner={partner} size={72} />
        </Surface>
      )}

      <View style={[styles.statsRow, { marginTop: space[3], gap: space[3] }]}>
        <Surface style={{ flex: 1, alignItems: 'center', paddingVertical: space[4] }}>
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('partners.cashback')}
          </Text>
          <Text style={[text.titleLg, { color: color.availableText, marginTop: space[1] }]}>
            {partner.cashbackPercent}%
          </Text>
        </Surface>
        <Surface style={{ flex: 1, alignItems: 'center', paddingVertical: space[4] }}>
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('partners.distance')}
          </Text>
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
                <PartnerPin
                  name={partner.name}
                  category={partner.category}
                  cashbackPercent={partner.cashbackPercent}
                  logoUrl={partner.logo?.url}
                  selected
                />
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

      {detail?.about ? (
        <Surface style={{ marginTop: space[3] }}>
          <Text style={[text.headline, { color: color.textPrimary }]}>
            {t('partners.about')}
          </Text>
          {/* The partner's own freeform text — never translated, rendered
              exactly as they wrote it, same as `partner.name`/`address`
              above. */}
          <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[2] }]}>
            {detail.about}
          </Text>
        </Surface>
      ) : null}

      {detail?.offerings && detail.offerings.length > 0 ? (
        <Surface style={{ marginTop: space[3] }} padded={false}>
          <View style={{ paddingHorizontal: space[4], paddingTop: space[4] }}>
            <Text style={[text.headline, { color: color.textPrimary }]}>
              {t('partners.offerings')}
            </Text>
          </View>
          {detail.offerings.map((offering, index) => (
            <OfferingRow
              key={offering.id}
              offering={offering}
              last={index === detail.offerings.length - 1}
            />
          ))}
        </Surface>
      ) : null}

      <Text
        style={[
          text.bodySm,
          { color: color.textSecondary, textAlign: 'center', marginTop: space[4] },
        ]}
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

/**
 * The 3:2 cover banner, spec §5. `children` — the logo/category block — is
 * rendered underneath it inside the same card rather than layered on top:
 * spec §5's gradient-overlay rule applies only when text sits *on* the
 * photo, and nothing here does, so there is nothing to darken for contrast.
 *
 * A failed load hides the `Image` but keeps `children` on screen — the same
 * "degrade to the logo, never to a broken box" contract `PartnerMark` keeps
 * for the logo itself, applied to the cover.
 */
function CoverImage({
  url,
  name,
  children,
}: {
  url: string;
  name: string;
  children: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <View>
      {!failed ? (
        <Image
          source={{ uri: url }}
          onError={() => setFailed(true)}
          style={styles.cover}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          accessibilityLabel={name}
        />
      ) : null}
      {children}
    </View>
  );
}

/**
 * One row of the partner's optional offerings list — name, price, and an
 * optional description, matching `ListRow`'s own title/subtitle/value shape.
 * Deliberately no `onPress`: this is a read-only listing, not a catalogue a
 * customer can tap into — there is no marketplace behind it yet, per Arman's
 * explicit "полноценный маркетплейс сейчас НЕ строим".
 */
function OfferingRow({ offering, last }: { offering: PartnerOfferingDto; last: boolean }) {
  const { space } = useTheme();
  return (
    <View style={{ paddingHorizontal: space[4] }}>
      <ListRow
        title={offering.name}
        subtitle={offering.description ?? undefined}
        value={formatAmd(offering.price)}
        last={last}
      />
    </View>
  );
}

/** The logo mark plus its category caption — identical content whether it
 * sits alone in a padded card (no cover) or under the cover banner, just at
 * a different size and with the cover's own padding standing in for the
 * card's. */
function LogoBlock({
  partner,
  size,
  paddingVertical,
}: {
  partner: NearbyPartnerDto;
  size: number;
  /** Omitted when the enclosing `Surface` already supplies its own padding. */
  paddingVertical?: number;
}) {
  const { color, space, text } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.logoBlock, paddingVertical !== undefined ? { paddingVertical } : null]}>
      <PartnerMark name={partner.name} logoUrl={partner.logo?.url} size={size} />
      <View style={[styles.categoryRow, { marginTop: space[3] }]}>
        <Ionicons name={CATEGORY_ICONS[partner.category]} size={14} color={color.textSecondary} />
        <Text style={[text.caption, { color: color.textSecondary, marginLeft: space[1] }]}>
          {t(`partnerCategory.${partner.category}`)}
        </Text>
      </View>
    </View>
  );
}

/** Same leading-icon bubble `SettingsScreen` rows use, so a detail row here
 * reads the same as everywhere else in the app. */
function InfoIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  const { color, radius } = useTheme();
  return (
    <View
      style={[styles.infoIcon, { backgroundColor: color.surfaceSunken, borderRadius: radius.md }]}
    >
      <Ionicons name={name} size={18} color={color.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  // 3:2 per spec §5 ("Use an official partner image at 3:2…").
  cover: { width: '100%', aspectRatio: 3 / 2 },
  logoBlock: { alignItems: 'center' },
  categoryRow: { flexDirection: 'row', alignItems: 'center' },
  statsRow: { flexDirection: 'row' },
  infoIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
