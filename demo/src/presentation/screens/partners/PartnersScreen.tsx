import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { NearbyPartnerDto, PartnerCategory } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { SectionHeader } from '../../components/SectionHeader';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { TileMap, type MapMarker } from '../../components/map/TileMap';
import { partnersApi } from '../../../data/api/partnersApi';
import { DEFAULT_CENTRE, useApproximateLocation } from './useApproximateLocation';
import { CATEGORY_ICONS, CATEGORY_ORDER, formatDistance } from './categories';
import { PartnerPin } from './PartnerPin';

/**
 * Where the customer's points are worth something.
 *
 * The screen the product was missing: a loyalty app whose partners could only
 * be discovered by walking past one. Map on top, filters under it, the list
 * below — and the two halves are one selection, so tapping a pin scrolls the
 * card into view and tapping a card lights up its pin.
 *
 * The search runs against the server rather than filtering what is already
 * loaded. A client-side filter over the first 300 rows silently searches a
 * subset, and "not found" from a search box is a statement about the whole
 * directory, not about what happened to be nearby.
 */
export function PartnersScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius, glass } = useTheme();

  const [category, setCategory] = useState<PartnerCategory | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<ScrollView>(null);
  const cardOffsets = useRef<Record<string, number>>({});

  const centre = useApproximateLocation();
  const query = useDebounced(search, 350);

  const partners = useQuery({
    queryKey: ['partners', 'nearby', centre.lat, centre.lng, category, query],
    queryFn: () =>
      partnersApi.nearby({
        lat: centre.lat,
        lng: centre.lng,
        radiusKm: 25,
        ...(category ? { category } : {}),
        ...(query ? { q: query } : {}),
      }),
  });

  // Memoised rather than `partners.data ?? []`, which is a fresh array on
  // every render and so re-derives every marker — and re-frames the map — on
  // each keystroke in the search box.
  const rows = useMemo(() => partners.data ?? [], [partners.data]);

  const markers: MapMarker[] = useMemo(
    () =>
      rows.map((row) => ({
        id: row.id,
        position: { lat: row.latitude, lng: row.longitude },
        render: (selected) => (
          <PartnerPin
            category={row.category}
            cashbackPercent={row.cashbackPercent}
            selected={selected}
          />
        ),
      })),
    [rows],
  );

  const selectFromMap = (id: string) => {
    setSelectedId(id);
    const offset = cardOffsets.current[id];
    if (offset !== undefined) {
      // `animated` rather than a jump: the card arriving from below is what
      // tells the person the pin and the list are the same thing.
      listRef.current?.scrollTo({ y: Math.max(0, offset - 80), animated: true });
    }
  };

  return (
    <Screen title={t('partners.title')} scroll={false}>
      <ScrollView
        ref={listRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: space[10] }}
        showsVerticalScrollIndicator={false}
      >
        <TileMap
          markers={markers}
          initialCentre={centre}
          selectedId={selectedId}
          onSelect={selectFromMap}
          height={260}
        />

        {/*
          Search first, chips under it. The other way round puts a horizontal
          scroller directly beneath a map that also pans horizontally, and the
          two fight over every sideways drag near the seam.
        */}
        <View
          style={[
            styles.search,
            {
              marginTop: space[4],
              backgroundColor: glass.background,
              borderColor: glass.border,
              borderRadius: radius.md,
              paddingHorizontal: space[4],
              gap: space[2],
            },
          ]}
        >
          <Ionicons name="search" size={18} color={color.textTertiary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('partners.searchPlaceholder')}
            placeholderTextColor={color.textTertiary}
            style={[text.body, styles.input, { color: color.textPrimary }]}
            returnKeyType="search"
            // Same reasoning as `TextField`: Android's autofill service has no
            // business in a search box, and offering to fill it is what made
            // every field on the auth screens light up at once.
            autoComplete="off"
            autoCorrect={false}
            importantForAutofill="no"
          />
          {search ? (
            <Pressable
              onPress={() => setSearch('')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.clear')}
            >
              <Ionicons name="close-circle" size={18} color={color.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.chips, { paddingVertical: space[4], gap: space[2] }]}
        >
          <Chip
            label={t('partners.all')}
            active={category === null}
            onPress={() => setCategory(null)}
          />
          {CATEGORY_ORDER.map((value) => (
            <Chip
              key={value}
              label={t(`partnerCategory.${value}`)}
              icon={CATEGORY_ICONS[value]}
              active={category === value}
              onPress={() => setCategory(category === value ? null : value)}
            />
          ))}
        </ScrollView>

        <SectionHeader title={t('partners.nearYou')} />

        {partners.isLoading ? (
          <>
            <Skeleton height={84} style={{ marginBottom: space[3] }} />
            <Skeleton height={84} style={{ marginBottom: space[3] }} />
            <Skeleton height={84} />
          </>
        ) : partners.isError ? (
          <EmptyState
            title={t('common.error')}
            message={t('partners.loadFailed')}
            actionLabel={t('common.retry')}
            onAction={() => partners.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('partners.emptyTitle')}
            message={
              search || category ? t('partners.emptyFiltered') : t('partners.emptyNearby')
            }
            {...(search || category
              ? {
                  actionLabel: t('partners.clearFilters'),
                  onAction: () => {
                    setSearch('');
                    setCategory(null);
                  },
                }
              : {})}
          />
        ) : (
          rows.map((row) => (
            <View
              key={row.id}
              onLayout={(e) => {
                cardOffsets.current[row.id] = e.nativeEvent.layout.y;
              }}
            >
              <PartnerCard
                partner={row}
                selected={row.id === selectedId}
                onPress={() => setSelectedId(row.id === selectedId ? null : row.id)}
              />
            </View>
          ))
        )}

        {centre.isFallback ? (
          // Said plainly rather than hidden: a list headed "near you" that is
          // actually "near the city centre" is a small lie, and the person can
          // simply drag the map once they know.
          <Text
            style={[
              text.caption,
              { color: color.textTertiary, textAlign: 'center', marginTop: space[4] },
            ]}
          >
            {t('partners.approximateLocation')}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function PartnerCard({
  partner,
  selected,
  onPress,
}: {
  partner: NearbyPartnerDto;
  selected: boolean;
  onPress: () => void;
}) {
  const { color, space, text, radius, premium } = useTheme();
  const { t } = useTranslation();

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Surface
        style={{
          marginBottom: space[3],
          ...(selected ? { borderColor: premium.brand.primary, borderWidth: 1 } : {}),
        }}
      >
        <View style={styles.cardRow}>
          <View
            style={[
              styles.cardIcon,
              { backgroundColor: color.surfaceSunken, borderRadius: radius.md },
            ]}
          >
            <Ionicons
              name={CATEGORY_ICONS[partner.category]}
              size={20}
              color={color.textSecondary}
            />
          </View>

          <View style={[styles.flex, { marginLeft: space[3] }]}>
            <Text style={[text.headline, { color: color.textPrimary }]} numberOfLines={1}>
              {partner.name}
            </Text>
            <Text
              style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}
              numberOfLines={1}
            >
              {partner.branchName} · {partner.address}
            </Text>
          </View>

          <View style={styles.trailing}>
            {/* The cashback is the reason the screen exists, so it is the
                brightest thing on the card. */}
            <Text style={[text.headline, { color: premium.brand.light }]}>
              {partner.cashbackPercent}%
            </Text>
            <Text style={[text.caption, { color: color.textTertiary, marginTop: 2 }]}>
              {formatDistance(partner.distanceKm)}
            </Text>
          </View>
        </View>

        {selected ? (
          <Text
            style={[
              text.bodySm,
              { color: color.textSecondary, marginTop: space[3] },
            ]}
          >
            {t('partners.howToEarn', { percent: partner.cashbackPercent })}
          </Text>
        ) : null}
      </Surface>
    </Pressable>
  );
}

function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  const { color, space, text, radius, premium, glass } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: radius.full,
          paddingHorizontal: space[4],
          gap: space[2],
          backgroundColor: active ? premium.brand.primary : glass.background,
          borderColor: active ? premium.brand.primary : glass.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={active ? color.textInverse : color.textSecondary}
        />
      ) : null}
      <Text style={[text.label, { color: active ? color.textInverse : color.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Holds a value still until the typing stops.
 *
 * Without it every keystroke is a request, and on a slow connection the
 * answers arrive out of order — the list settles on whatever the server
 * happened to finish last, which for "кафе" is often the results for "каф".
 */
function useDebounced(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(value.trim()), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

export { DEFAULT_CENTRE };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  search: { flexDirection: 'row', alignItems: 'center', height: 48, borderWidth: 1 },
  input: { flex: 1, paddingVertical: 0 },
  chips: { flexDirection: 'row', alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', height: 34, borderWidth: 1 },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  cardIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  trailing: { alignItems: 'flex-end' },
});
