import React, { useCallback, useRef } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { PartnerPromoPublicDto } from '@tutak/shared-types';
import { useTheme } from '../../app/theme/ThemeProvider';
import { promosApi } from '../../data/api/promosApi';
import { PartnerMark } from './PartnerMark';
import { SectionHeader } from './SectionHeader';

/**
 * Home "Partner Spotlight" — a horizontal strip of curated partner offers.
 *
 * ## What it is, and is not
 *
 * A short editorial strip: three to five cards a platform administrator
 * chose, each a photograph with the app's own text set over it. It is not a
 * banner slot. Nothing autoplays, nothing paginates with a row of dots, and
 * when the server has nothing to show the whole section — header included
 * — is simply absent. A strip that draws a "no offers" placeholder would be
 * advertising the absence of advertising.
 *
 * ## Why the numbers are what they are
 *
 * The card is 86% of the content width so the next one is visibly there
 * (a strip whose second card is entirely off-screen is a single banner to
 * most people), and the list snaps to card boundaries so a swipe ends on a
 * whole card rather than half of two. 16:10 is the artwork's own shape,
 * fixed on the server (`PROMO_ARTWORK`), so a card never letterboxes.
 *
 * ## What is reported, and when
 *
 * Two events, both fire-and-forget: `IMPRESSION` once per card per app
 * session, and only after the card has been at least 60% on screen for half
 * a second — a card that arrived from the API and scrolled past unseen is
 * not an impression — and `OPEN` on tap. Neither carries anything about
 * the person; the server increments a counter on the card.
 *
 * ## Failure
 *
 * The query never blocks Home: it runs beside the wallet and transactions,
 * and on error the strip is absent, same as when it is empty. A card whose
 * artwork fails to load keeps its text on a plain brand surface rather than
 * showing a broken image (`TUTAK_V2_MEDIA_SYSTEM_SPEC.md` §6).
 */

/** Impressions already reported this app session, so a re-render or a
 * scroll back does not count the same card twice. Module-level on purpose:
 * Home unmounts and remounts on tab changes, and the rule is per session. */
const reportedImpressions = new Set<string>();

export function PartnerSpotlight({ onOpen }: { onOpen: (promo: PartnerPromoPublicDto) => void }) {
  const { t } = useTranslation();
  const { space, layout } = useTheme();
  const { width } = useWindowDimensions();

  const { data } = useQuery({
    queryKey: ['promos', 'featured'],
    queryFn: promosApi.featured,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const contentWidth = width - layout.screenPaddingX * 2;
  const gap = space[3];
  const cardWidth = Math.round(contentWidth * 0.86);
  const cardHeight = Math.round(cardWidth * 0.62);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    for (const token of viewableItems) {
      if (!token.isViewable) continue;
      const promo = token.item as PartnerPromoPublicDto;
      if (reportedImpressions.has(promo.id)) continue;
      reportedImpressions.add(promo.id);
      promosApi.event(promo.id, 'IMPRESSION').catch(() => undefined);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 500 }).current;

  const open = useCallback(
    (promo: PartnerPromoPublicDto) => {
      promosApi.event(promo.id, 'OPEN').catch(() => undefined);
      onOpen(promo);
    },
    [onOpen],
  );

  if (!data || data.length === 0) return null;

  return (
    <View>
      <View style={{ paddingHorizontal: layout.screenPaddingX }}>
        <SectionHeader title={t('home.partnerOffers')} />
      </View>
      <FlatList
        horizontal
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SpotlightCard
            promo={item}
            width={cardWidth}
            height={cardHeight}
            promoMark={t('home.promoMark')}
            onPress={() => open(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ width: gap }} />}
        contentContainerStyle={{ paddingHorizontal: layout.screenPaddingX }}
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + gap}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        accessibilityRole="list"
      />
    </View>
  );
}

function SpotlightCard({
  promo,
  width,
  height,
  promoMark,
  onPress,
}: {
  promo: PartnerPromoPublicDto;
  width: number;
  height: number;
  promoMark: string;
  onPress: () => void;
}) {
  const { color, space, radius, text, motion, palette } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const [artworkFailed, setArtworkFailed] = React.useState(false);

  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, ...motion.springConfig.snappy }).start();

  const artwork = !artworkFailed && promo.artwork ? promo.artwork.url : null;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => press(0.98)}
        onPressOut={() => press(1)}
        accessibilityRole="button"
        accessibilityLabel={`${promo.partnerName}. ${promo.title}. ${promo.benefitLabel}`}
        style={[
          styles.card,
          { width, height, borderRadius: radius.lg, backgroundColor: palette.brand[700] },
        ]}
      >
        {artwork ? (
          <Image
            source={{ uri: artwork }}
            contentFit="cover"
            transition={180}
            cachePolicy="memory-disk"
            onError={() => setArtworkFailed(true)}
            accessibilityIgnoresInvertColors
            style={StyleSheet.absoluteFill}
          />
        ) : (
          // No photograph: a plain brand field. The text below still reads,
          // and nothing says "image missing".
          <LinearGradient
            colors={[palette.brand[800], palette.brand[600]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}

        {/* The scrim exists for the text, so it lives where the text is:
            clear at the top, deepening through the lower half. */}
        <LinearGradient
          colors={['rgba(6,18,12,0)', 'rgba(6,18,12,0.35)', 'rgba(6,18,12,0.82)']}
          locations={[0.3, 0.62, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={[styles.top, { padding: space[4] }]}>
          <View style={[styles.benefit, { borderRadius: radius.full, paddingHorizontal: space[3] }]}>
            <Text style={[text.label, styles.benefitText, { color: color.primary }]} numberOfLines={1}>
              {promo.benefitLabel}
            </Text>
          </View>
          {promo.sponsored ? (
            <Text style={[text.caption, styles.mark]} numberOfLines={1}>
              {promoMark}
            </Text>
          ) : null}
        </View>

        <View style={[styles.bottom, { padding: space[4], gap: space[1] }]}>
          <View style={[styles.partnerRow, { gap: space[2] }]}>
            <PartnerMark name={promo.partnerName} logoUrl={promo.partnerLogo?.thumbnailUrl} size={22} circular />
            <Text style={[text.caption, styles.partnerName]} numberOfLines={1}>
              {promo.partnerName}
            </Text>
          </View>
          <Text style={[text.headline, styles.title]} numberOfLines={2}>
            {promo.title}
          </Text>
          {promo.subtitle ? (
            <Text style={[text.caption, styles.subtitle]} numberOfLines={1}>
              {promo.subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bottom: {},
  benefit: { height: 28, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.94)' },
  benefitText: { fontWeight: '600' },
  mark: { color: 'rgba(255,255,255,0.72)' },
  partnerRow: { flexDirection: 'row', alignItems: 'center' },
  partnerName: { color: 'rgba(255,255,255,0.82)', flexShrink: 1 },
  title: { color: '#FFFFFF' },
  subtitle: { color: 'rgba(255,255,255,0.72)' },
});
