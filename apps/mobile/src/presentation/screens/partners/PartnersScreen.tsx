import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type {
  EvConnectorDto,
  EvStationDto,
  NearbyPartnerDto,
  PartnerCategory,
} from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { MainTabParamList, RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { SectionHeader } from '../../components/SectionHeader';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { StatePill } from '../../components/StatePill';
import { TileMap, type MapMarker } from '../../components/map/TileMap';
import { partnersApi } from '../../../data/api/partnersApi';
import { evApi } from '../../../data/api/evApi';
import { evStatusTone } from '../../utils/transactionPresentation';
import { formatAmd } from '../../utils/format';
import { DEFAULT_CENTRE, useApproximateLocation } from './useApproximateLocation';
import { CATEGORY_ICONS, CATEGORY_ORDER, formatDistance } from './categories';
import { PartnerPin } from './PartnerPin';
import { StationPin } from './StationPin';

type PartnersRoute = RouteProp<MainTabParamList, 'Partners'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

/** What the chip strip can be narrowed to. Stations are not a `PartnerCategory`
 * — they are TuTak's own charging network, a different thing from the
 * `EV_CHARGING` partner category (third-party shops that sell charging-adjacent
 * goods) — so it is its own arm of the union rather than a value inside it. */
type Filter = { kind: 'all' } | { kind: 'category'; value: PartnerCategory } | { kind: 'stations' };

type MapItem =
  | { kind: 'partner'; id: string; distanceKm: number; partner: NearbyPartnerDto }
  | { kind: 'station'; id: string; distanceKm: number; station: EvStationDto };

/**
 * One map for everywhere a customer's points are worth something.
 *
 * Stations and partners used to be two separate places in this app — a
 * station list with no map, reached only from a home-screen button, and this
 * screen showing partners alone. The mockups draw one map instead: green pins
 * for TuTak's own charging stations, coloured pins for partner categories,
 * "Станции" just another chip in the same strip, one "Рядом с вами" list
 * carrying both kinds of card. This screen is that merge — see
 * `docs/DESIGN_HANDOFF_RU.md` §0 for the decision.
 *
 * The search runs against the server rather than filtering what is already
 * loaded. A client-side filter over the first 300 rows silently searches a
 * subset, and "not found" from a search box is a statement about the whole
 * directory, not about what happened to be nearby. It only searches partners
 * by name — the placeholder says as much ("Магазин, кафе, улица…") — a
 * station's name is rarely what someone types.
 */
export function PartnersScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius, glass } = useTheme();
  const route = useRoute<PartnersRoute>();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<Filter>(
    route.params?.filter === 'stations' ? { kind: 'stations' } : { kind: 'all' },
  );
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<ScrollView>(null);
  const cardOffsets = useRef<Record<string, number>>({});

  // The home screen's "Начать зарядку" quick action always wants the
  // stations chip active, even if this tab was already open on a different
  // filter — a param object is a fresh reference on every navigate call, so
  // this fires each time the button is pressed, not just on first mount.
  React.useEffect(() => {
    if (route.params?.filter === 'stations') setFilter({ kind: 'stations' });
  }, [route.params]);

  const centre = useApproximateLocation();
  const query = useDebounced(search, 350);

  const showPartners = filter.kind !== 'stations';
  const showStations = filter.kind === 'all' || filter.kind === 'stations';

  const partners = useQuery({
    queryKey: [
      'partners',
      'nearby',
      centre.lat,
      centre.lng,
      filter.kind === 'category' ? filter.value : null,
      query,
    ],
    queryFn: () =>
      partnersApi.nearby({
        lat: centre.lat,
        lng: centre.lng,
        radiusKm: 25,
        ...(filter.kind === 'category' ? { category: filter.value } : {}),
        ...(query ? { q: query } : {}),
      }),
    enabled: showPartners,
  });

  const stations = useQuery({
    queryKey: ['ev-stations', 'nearby', centre.lat, centre.lng],
    queryFn: () => evApi.nearbyStations(centre.lat, centre.lng, 25),
    enabled: showStations,
  });

  // A customer can only be charging in one place at a time, and the API
  // enforces it. Knowing about it here turns a confusing rejection into a
  // banner that takes them back to the session they already have.
  const activeSession = useQuery({
    queryKey: ['ev-active-session'],
    queryFn: evApi.activeSession,
  });

  const start = useMutation({
    mutationFn: (connectorId: string) => evApi.startSession({ connectorId }),
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: ['ev-stations'] });
      queryClient.setQueryData(['ev-active-session'], session);
      navigation.navigate('EvSession', { session });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        t('common.somethingWentWrong');
      Alert.alert(t('ev.couldNotStart'), message);
    },
  });

  // Memoised rather than `.data ?? []`, which is a fresh array on every
  // render and so re-derives every marker — and re-frames the map — on each
  // keystroke in the search box.
  const partnerRows = useMemo(() => (showPartners ? (partners.data ?? []) : []), [
    showPartners,
    partners.data,
  ]);
  const stationRows = useMemo(() => (showStations ? (stations.data ?? []) : []), [
    showStations,
    stations.data,
  ]);

  const items: MapItem[] = useMemo(() => {
    const merged: MapItem[] = [
      ...partnerRows.map((p) => ({
        kind: 'partner' as const,
        id: p.id,
        distanceKm: p.distanceKm,
        partner: p,
      })),
      ...stationRows.map((s) => ({
        kind: 'station' as const,
        id: s.id,
        distanceKm: s.distanceKm ?? 0,
        station: s,
      })),
    ];
    return merged.sort((a, b) => a.distanceKm - b.distanceKm);
  }, [partnerRows, stationRows]);

  const markers: MapMarker[] = useMemo(
    () =>
      items.map((item) =>
        item.kind === 'partner'
          ? {
              id: item.id,
              position: { lat: item.partner.latitude, lng: item.partner.longitude },
              render: (selected: boolean) => (
                <PartnerPin
                  category={item.partner.category}
                  cashbackPercent={item.partner.cashbackPercent}
                  selected={selected}
                />
              ),
            }
          : {
              id: item.id,
              position: { lat: item.station.latitude, lng: item.station.longitude },
              render: (selected: boolean) => (
                <StationPin
                  freeConnectors={item.station.connectors.filter((c) => c.status === 'AVAILABLE').length}
                  totalConnectors={item.station.connectors.length}
                  selected={selected}
                />
              ),
            },
      ),
    [items],
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

  const isLoading = (showPartners && partners.isLoading) || (showStations && stations.isLoading);
  const isError = (showPartners && partners.isError) || (showStations && stations.isError);
  const hasFilter = Boolean(search) || filter.kind !== 'all';

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
            active={filter.kind === 'all'}
            onPress={() => setFilter({ kind: 'all' })}
          />
          <Chip
            label={t('partners.stations')}
            icon="flash-outline"
            active={filter.kind === 'stations'}
            onPress={() => setFilter(filter.kind === 'stations' ? { kind: 'all' } : { kind: 'stations' })}
          />
          {CATEGORY_ORDER.map((value) => (
            <Chip
              key={value}
              label={t(`partnerCategory.${value}`)}
              icon={CATEGORY_ICONS[value]}
              active={filter.kind === 'category' && filter.value === value}
              onPress={() =>
                setFilter(
                  filter.kind === 'category' && filter.value === value
                    ? { kind: 'all' }
                    : { kind: 'category', value },
                )
              }
            />
          ))}
        </ScrollView>

        {activeSession.data ? (
          <Pressable
            onPress={() => navigation.navigate('EvSession', { session: activeSession.data ?? undefined })}
          >
            <Surface style={{ marginBottom: space[3], backgroundColor: color.availableSurface }}>
              <View style={styles.cardRow}>
                <Ionicons name="flash" size={20} color={color.availableText} />
                <View style={[styles.flex, { marginLeft: space[3] }]}>
                  <Text style={[text.headline, { color: color.availableText }]}>
                    {t('ev.chargingNow')}
                  </Text>
                  <Text style={[text.caption, { color: color.availableText, marginTop: space[1] }]}>
                    {t('ev.tapToManage')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={color.availableText} />
              </View>
            </Surface>
          </Pressable>
        ) : null}

        <SectionHeader title={t('partners.nearYou')} />

        {isLoading ? (
          <>
            <Skeleton height={84} style={{ marginBottom: space[3] }} />
            <Skeleton height={84} style={{ marginBottom: space[3] }} />
            <Skeleton height={84} />
          </>
        ) : isError ? (
          <EmptyState
            title={t('common.error')}
            message={t('partners.loadFailed')}
            actionLabel={t('common.retry')}
            onAction={() => {
              if (showPartners) partners.refetch();
              if (showStations) stations.refetch();
            }}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={t('partners.emptyTitle')}
            message={hasFilter ? t('partners.emptyFiltered') : t('partners.emptyNearby')}
            {...(hasFilter
              ? {
                  actionLabel: t('partners.clearFilters'),
                  onAction: () => {
                    setSearch('');
                    setFilter({ kind: 'all' });
                  },
                }
              : {})}
          />
        ) : (
          items.map((item) => (
            <View
              key={item.id}
              onLayout={(e) => {
                cardOffsets.current[item.id] = e.nativeEvent.layout.y;
              }}
            >
              {item.kind === 'partner' ? (
                <PartnerCard
                  partner={item.partner}
                  selected={item.id === selectedId}
                  onPress={() => setSelectedId(item.id === selectedId ? null : item.id)}
                />
              ) : (
                <StationCard
                  station={item.station}
                  distanceKm={item.distanceKm}
                  selected={item.id === selectedId}
                  onPress={() => setSelectedId(item.id === selectedId ? null : item.id)}
                  onStart={(c) => start.mutate(c.id)}
                  startingConnectorId={start.isPending ? (start.variables ?? null) : null}
                  disabled={!!activeSession.data || start.isPending}
                />
              )}
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

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
          <>
            <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[3] }]}>
              {t('partners.howToEarn', { percent: partner.cashbackPercent })}
            </Text>
            <View style={{ marginTop: space[3] }}>
              <Button
                label={t('purchaseIntent.payHere')}
                size="sm"
                fullWidth={false}
                onPress={() =>
                  navigation.navigate('CreatePurchaseIntent', {
                    partnerId: partner.partnerId,
                    partnerBranchId: partner.id,
                    partnerName: partner.name,
                  })
                }
              />
            </View>
          </>
        ) : null}
      </Surface>
    </Pressable>
  );
}

function StationCard({
  station,
  distanceKm,
  selected,
  onPress,
  onStart,
  startingConnectorId,
  disabled,
}: {
  station: EvStationDto;
  distanceKm: number;
  selected: boolean;
  onPress: () => void;
  onStart: (connector: EvConnectorDto) => void;
  startingConnectorId: string | null;
  disabled: boolean;
}) {
  const { color, space, text, radius, glass, premium } = useTheme();
  const { t } = useTranslation();

  const free = station.connectors.filter((c) => c.status === 'AVAILABLE').length;
  const total = station.connectors.length;
  const anyFree = free > 0;

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
              {
                backgroundColor: anyFree ? color.availableSurface : color.surfaceSunken,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              name="flash"
              size={20}
              color={anyFree ? color.availableText : color.textTertiary}
            />
          </View>

          <View style={[styles.flex, { marginLeft: space[3] }]}>
            <Text style={[text.headline, { color: color.textPrimary }]} numberOfLines={1}>
              {station.name}
            </Text>
            <Text
              style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}
              numberOfLines={1}
            >
              {station.address}
            </Text>
          </View>

          {/* Matches PartnerCard's trailing column — a station's headline
              number is free bays rather than a cashback percent, but the
              distance underneath it is the same measure on both card types,
              which is what lets one sorted list hold both. */}
          <View style={styles.trailing}>
            <StatePill
              state={anyFree ? 'available' : 'pending'}
              label={t('ev.connectorsFree', { free, total })}
            />
            <Text style={[text.caption, { color: color.textTertiary, marginTop: 2 }]}>
              {formatDistance(distanceKm)}
            </Text>
          </View>
        </View>

        {/* Connector strip: type, power and price at a glance — and the tap
            target that starts a session. An unavailable bay stays visible but
            inert, because "there is a CCS2 here and someone is using it" is
            different information from "there is no CCS2 here". */}
        <View style={[styles.connectors, { marginTop: space[4], gap: space[2] }]}>
          {station.connectors.map((c) => {
            const startable = c.status === 'AVAILABLE' && !disabled;
            const starting = startingConnectorId === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => onStart(c)}
                disabled={!startable || starting}
                accessibilityRole="button"
                accessibilityLabel={t('ev.startAt', {
                  connector: c.connectorType.replace('_', ' '),
                  station: station.name,
                })}
                style={({ pressed }) => [
                  styles.connector,
                  {
                    borderColor: startable ? glass.border : color.border,
                    backgroundColor: startable && pressed ? glass.light : 'transparent',
                    opacity: startable || starting ? 1 : 0.55,
                    borderRadius: radius.md,
                    paddingHorizontal: space[3],
                    paddingVertical: space[2],
                    gap: space[2],
                  },
                ]}
              >
                {starting ? (
                  <ActivityIndicator size="small" color={color.primary} />
                ) : (
                  <View style={[styles.statusDot, { backgroundColor: dotFor(c.status, color) }]} />
                )}
                <Text style={[text.caption, { color: color.textPrimary }]}>
                  {c.connectorType.replace('_', ' ')}
                </Text>
                <Text style={[text.caption, { color: color.textTertiary }]}>
                  {Number(c.powerKw)} kW · {formatAmd(c.pricePerKwh)}
                </Text>
                {startable ? (
                  <Ionicons name="play-circle" size={16} color={color.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Surface>
    </Pressable>
  );
}

function dotFor(status: string, color: ReturnType<typeof useTheme>['color']) {
  const tone = evStatusTone(status);
  return tone === 'available'
    ? color.availableFill
    : tone === 'reserved'
      ? color.reservedFill
      : color.textTertiary;
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
  connectors: { flexDirection: 'row', flexWrap: 'wrap' },
  connector: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
});
