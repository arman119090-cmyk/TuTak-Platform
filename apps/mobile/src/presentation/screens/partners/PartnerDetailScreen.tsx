import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { PartnerOfferingDto } from '@tutak/shared-types';
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
  const { color, space, text, palette } = useTheme();
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  /*
   * Two ways in. A map pin brings the whole nearby record — a branch with
   * coordinates, a distance, an address — and the screen renders it at once.
   * A Home "Partner Spotlight" card brings only a partner id: the business,
   * not a branch. Then the identity comes from `GET /partners/:id` and the
   * branch-only parts (distance, mini-map, address, "pay here") are simply
   * not drawn; the map is offered instead, so a chain's nearest shop is the
   * customer's pick, not this screen's guess.
   */
  const nearby = 'partner' in params ? params.partner : null;
  const partnerId = nearby ? nearby.partnerId : (params as { partnerId: string }).partnerId;

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['partner', partnerId],
    queryFn: () => partnersApi.get(partnerId),
  });

  const name = nearby?.name ?? detail?.displayName ?? '';
  const category = nearby?.category ?? detail?.category;
  const logoUrl = nearby?.logo?.url ?? detail?.logo?.url;
  const cover = nearby?.cover ?? detail?.cover ?? null;
  const cashbackPercent = nearby?.cashbackPercent ?? (detail ? detail.bonusAccrualRateBps / 100 : null);

  if (!nearby && detailLoading) {
    return (
      <Screen title={t('partners.title')}>
        <View style={{ paddingTop: space[6], alignItems: 'center' }}>
          <ActivityIndicator color={color.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={name} subtitle={nearby?.branchName}>
      {cover ? (
        <Surface padded={false}>
          <CoverImage url={cover.url} name={name}>
            <LogoBlock name={name} logoUrl={logoUrl} category={category} size={64} paddingVertical={space[5]} />
          </CoverImage>
        </Surface>
      ) : (
        <View style={{ paddingVertical: space[4] }}>
          <LogoBlock name={name} logoUrl={logoUrl} category={category} size={72} />
        </View>
      )}

      {/* The two numbers a customer came for, as a line under a rule —
          the same statement shape as the wallet totals, not two tiles. */}
      <View
        style={[
          styles.statsRow,
          {
            marginTop: space[4],
            paddingVertical: space[4],
            gap: space[4],
            borderTopWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: palette.neutral[100],
          },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('partners.cashback')}
          </Text>
          <Text style={[text.title, { color: color.availableText, marginTop: 2 }]}>
            {cashbackPercent === null ? '—' : `${cashbackPercent}%`}
          </Text>
        </View>
        {nearby ? (
          <View style={{ flex: 1 }}>
            <Text style={[text.caption, { color: color.textSecondary }]}>
              {t('partners.distance')}
            </Text>
            <Text style={[text.title, { color: color.textPrimary, marginTop: 2 }]}>
              {formatDistance(nearby.distanceKm)}
            </Text>
          </View>
        ) : null}
      </View>

      {nearby ? (
        <>
          <View style={{ marginTop: space[4] }}>
            <TileMap
              markers={[
                {
                  id: nearby.id,
                  position: { lat: nearby.latitude, lng: nearby.longitude },
                  render: () => (
                    <PartnerPin
                      name={nearby.name}
                      category={nearby.category}
                      cashbackPercent={nearby.cashbackPercent}
                      logoUrl={nearby.logo?.url}
                      selected
                    />
                  ),
                },
              ]}
              initialCentre={{ lat: nearby.latitude, lng: nearby.longitude }}
              initialZoom={16}
              height={180}
              unavailableLabel={t('partners.mapUnavailable')}
            />
          </View>

          <View style={{ marginTop: space[3] }}>
            <ListRow
              title={t('partners.address')}
              subtitle={`${nearby.address}, ${nearby.city}`}
              leading={<InfoIcon name="location-outline" />}
              last
            />
          </View>
        </>
      ) : (
        // No branch chosen yet: the map, narrowed to this partner, is where
        // the customer picks one. Secondary, because the page is the offer.
        <View style={{ marginTop: space[4] }}>
          <Button
            label={t('partners.showOnMap')}
            variant="secondary"
            onPress={() =>
              navigation.navigate('Main', { screen: 'Partners', params: { q: name } } as never)
            }
            icon={<Ionicons name="map-outline" size={18} color={color.textPrimary} />}
          />
        </View>
      )}

      {detail?.about ? (
        <View style={{ marginTop: space[5] }}>
          <Text style={[text.headline, { color: color.textPrimary }]}>
            {t('partners.about')}
          </Text>
          {/* The partner's own freeform text — never translated, rendered
              exactly as they wrote it, same as `partner.name`/`address`
              above. */}
          <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[2] }]}>
            {detail.about}
          </Text>
        </View>
      ) : null}

      {detail?.offerings && detail.offerings.length > 0 ? (
        <View style={{ marginTop: space[5] }}>
          <View style={{ paddingBottom: space[2] }}>
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
        </View>
      ) : null}

      <Text
        style={[
          text.bodySm,
          { color: color.textSecondary, textAlign: 'center', marginTop: space[4] },
        ]}
      >
        {t('partners.howToEarn', { percent: cashbackPercent ?? 0 })}
      </Text>

      {/*
        The other half of the deal, and the half the customer used to learn
        by being refused at the till: how much of the bill their points may
        actually cover here. `maxBonusPaymentPercent` is the partner's own
        published ceiling, and 100 is phrased as "the whole bill" rather
        than "up to 100%", which reads like a restriction.
      */}
      {typeof detail?.maxBonusPaymentPercent === 'number' ? (
        <Text
          style={[
            text.bodySm,
            { color: color.textSecondary, textAlign: 'center', marginTop: space[2] },
          ]}
        >
          {detail.maxBonusPaymentPercent >= 100
            ? t('partners.howToSpendAll')
            : t('partners.howToSpend', { percent: detail.maxBonusPaymentPercent })}
        </Text>
      ) : null}

      {/*
        A business that is not trading does not get a Pay button that leads
        to a refusal. `status` distinguishes the two cases that matter to a
        customer standing in front of the place: one that has applied and is
        waiting, and one that was switched off.

        Phrased as "the server said no", not "the server did not say yes":
        while the detail is still loading — and against any older build of
        the API that does not send `status` at all — the button stays. The
        nearby list only ever contains trading partners, so the optimistic
        case is also the true one, and a field this screen cannot see must
        never be the reason a customer cannot pay.
      */}
      {detail && (detail.isActive === false || (detail.status && detail.status !== 'ACTIVE')) ? (
        <View style={{ marginTop: space[4], paddingVertical: space[4] }}>
          <Text style={[text.bodySm, { color: color.textSecondary, textAlign: 'center' }]}>
            {detail.status === 'PENDING_APPROVAL'
              ? t('partners.notTradingYet')
              : t('partners.notTrading')}
          </Text>
        </View>
      ) : nearby ? (
        <View style={{ marginTop: space[4] }}>
          <Button
            label={t('purchaseIntent.payHere')}
            onPress={() =>
              navigation.navigate('CreatePurchaseIntent', {
                partnerId: nearby.partnerId,
                partnerBranchId: nearby.id,
                partnerName: nearby.name,
              })
            }
            icon={<JakoWingMark size={16} color={color.textInverse} />}
          />
        </View>
      ) : null}
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
  return (
    <View>
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
  name,
  logoUrl,
  category,
  size,
  paddingVertical,
}: {
  name: string;
  logoUrl?: string;
  category?: string;
  size: number;
  /** Omitted when the enclosing `Surface` already supplies its own padding. */
  paddingVertical?: number;
}) {
  const { color, space, text } = useTheme();
  const { t } = useTranslation();
  const icon = category ? CATEGORY_ICONS[category as keyof typeof CATEGORY_ICONS] : undefined;

  return (
    <View style={[styles.logoBlock, paddingVertical !== undefined ? { paddingVertical } : null]}>
      <PartnerMark name={name} logoUrl={logoUrl} size={size} />
      {category ? (
        <View style={[styles.categoryRow, { marginTop: space[3] }]}>
          {icon ? <Ionicons name={icon} size={14} color={color.textSecondary} /> : null}
          <Text style={[text.caption, { color: color.textSecondary, marginLeft: space[1] }]}>
            {t(`partnerCategory.${category}`)}
          </Text>
        </View>
      ) : null}
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
