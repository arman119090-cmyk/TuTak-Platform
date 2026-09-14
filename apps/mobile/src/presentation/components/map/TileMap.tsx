import React, { useCallback, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import {
  fitBounds,
  panBy,
  screenPosition,
  tilesForViewport,
  TILE_SIZE,
  type LatLng,
} from './mercator';
import { attribution, tileRequestHeaders, tileUrl } from './tileSource';

/**
 * A slippy map, built out of `<Image>` and arithmetic.
 *
 * See `tileSource.ts` for why there is no map SDK behind this. The short
 * version: a native map on Android needs a Google API key we do not have, and
 * a native module needs a build to prove itself, which this project can
 * ill afford. Everything here runs the same on Android, iOS and web.
 *
 * The projection lives in `mercator.ts` and is tested there. This component
 * owns only the parts that need a screen: measuring itself, turning a drag
 * into a new centre, and placing markers.
 */

export interface MapMarker {
  id: string;
  position: LatLng;
  /** Drawn centred on the coordinate; the pin below anchors at its point. */
  render: (selected: boolean) => React.ReactNode;
}

const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

/**
 * How much of a screenful has to fail before the map admits it.
 *
 * One tile that does not arrive is a dropped request, and the map still reads
 * correctly around the gap. Most of them failing is a different event — no
 * network, a revoked key, a provider quota reached — and it leaves a blank
 * rectangle that looks exactly like an area with nothing in it. That is the
 * failure worth naming: a customer staring at an empty square cannot tell
 * "the map is broken" from "there is nothing here", and will conclude the
 * second.
 */
const TILES_FAILED_BEFORE_SAYING_SO = 0.5;

export function TileMap({
  markers,
  frameKey,
  initialCentre,
  initialZoom = 13,
  selectedId,
  onSelect,
  height = 260,
  unavailableLabel,
}: {
  markers: MapMarker[];
  /**
   * What the caller asked for, as a string — the filter chip, the search
   * text, whatever decides *which* markers these are.
   *
   * The map reframes when this changes, because a different question
   * deserves a fresh view even if the person had dragged. It deliberately
   * does **not** reframe when only the markers change underneath an
   * unchanged question: that happens on its own whenever the nearby query
   * re-runs, and reframing then throws away the place the person dragged to.
   *
   * Omit it and the map simply never reframes after a drag, which is the
   * safe half of the behaviour.
   */
  frameKey?: string;
  initialCentre: LatLng;
  initialZoom?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
  /**
   * What to say when the basemap will not load. Passed in rather than
   * translated here so this component stays free of i18n, like every other
   * piece of pure presentation in this folder. Omitted, the map fails the
   * way it always did — silently.
   */
  unavailableLabel?: string;
}) {
  const { color, radius, space, text, premium } = useTheme();

  const [size, setSize] = useState({ width: 0, height: 0 });
  // Keyed by tile URL, not by z/x/y: a tile that failed under one provider
  // is not the same request after the provider changes, and a pan back to a
  // previously failed square should ask again rather than stay condemned.
  const [failedTiles, setFailedTiles] = useState<ReadonlySet<string>>(new Set());
  const noteTileFailed = useCallback((uri: string) => {
    setFailedTiles((previous) => {
      if (previous.has(uri)) return previous;
      const next = new Set(previous);
      next.add(uri);
      return next;
    });
  }, []);
  const [centre, setCentre] = useState<LatLng>(initialCentre);
  const [zoom, setZoom] = useState(initialZoom);

  /**
   * `initialCentre` is not fixed any more: it starts as the city centre and
   * becomes the person's real position when the fix arrives, seconds later.
   * The map follows that change — but only until the person takes over. Once
   * they have dragged, being yanked somewhere else by a late fix is the map
   * losing their place, which is the one thing a map must never do.
   */
  const takenOver = useRef(false);
  const followed = useRef(`${initialCentre.lat},${initialCentre.lng}`);
  const initialKey = `${initialCentre.lat},${initialCentre.lng}`;
  if (!takenOver.current && followed.current !== initialKey) {
    followed.current = initialKey;
    setCentre(initialCentre);
  }

  // The pan is read and written between renders, so it is a ref: routing it
  // through state would re-render on every one of the sixty frames a drag
  // produces and re-fetch the tile grid each time.
  const dragStart = useRef<{ centre: LatLng; zoom: number } | null>(null);

  /**
   * Where the map is, readable from a callback that outlives the render it
   * was created in.
   *
   * These exist so the `PanResponder` below can be built exactly once. See
   * the comment on it: rebuilding it mid-gesture silently throws away most
   * of the drag, and the only reason it was being rebuilt was to let its
   * handlers see the current centre and zoom. A ref does that without
   * changing identity.
   */
  const centreRef = useRef(centre);
  const zoomRef = useRef(zoom);
  centreRef.current = centre;
  zoomRef.current = zoom;

  // What the map was last told to fit. A screen whose results change — a
  // category chip, a search — should reframe; a screen the user has just
  // dragged should not be yanked back.
  //
  // Keying this on the markers alone was wrong, and wrong in a way that
  // looked like the map refusing to move: the nearby query re-runs whenever
  // the device's own position updates, the marker set comes back different,
  // and the map reframed — undoing the drag seconds after it happened. The
  // question being asked is what should decide this, so `frameKey` does.
  const fitted = useRef<string | null>(null);
  const askedFor = useRef<string | undefined>(frameKey);
  const markerKey = markers.map((m) => m.id).join('|');

  // A new question: follow it, even if the person had taken the map over.
  // They asked for this.
  const questionChanged = askedFor.current !== frameKey;
  if (questionChanged) {
    askedFor.current = frameKey;
    takenOver.current = false;
  }

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height: h } = event.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === h ? prev : { width, height: h }));
  }, []);

  // Frame the pins as soon as there is both a viewport and something to show.
  // Done during render rather than in an effect so the first painted frame is
  // already framed — an effect would show one frame at the default centre and
  // then jump, which reads as the map having lost its place.
  const shouldFrame =
    fitted.current !== markerKey && (questionChanged || !takenOver.current);
  if (size.width > 0 && markers.length > 0 && shouldFrame) {
    fitted.current = markerKey;
    const fit = fitBounds({
      points: markers.map((m) => m.position),
      width: size.width,
      height: size.height,
      maxZoom: 16,
    });
    if (fit && (fit.centre.lat !== centre.lat || fit.centre.lng !== centre.lng)) {
      setCentre(fit.centre);
      setZoom(fit.zoom);
    }
  }

  /**
   * Built once for the life of the component, and that is the whole point.
   *
   * This used to be `useMemo(..., [centre, zoom])` so the handlers could read
   * the current position. The trap: `onPanResponderMove` calls `setCentre`,
   * `panBy` returns a fresh object, so `centre` changed identity on every
   * frame of a drag — and a new `PanResponder` came with it.
   *
   * That matters because `gesture.dx` is not computed from the event. It is
   * accumulated inside the responder's own `gestureState`, which starts at
   * zero and is only advanced by the frames *that instance* has seen. A
   * replacement instance never receives `onPanResponderGrant`, so it starts
   * from `dx: 0` and adds only the frames after its own creation — while
   * `panBy` below measures from where the drag began. The two disagree, and
   * the map ends up displaced by a single frame's worth of movement and
   * snapping back to the start on the next one.
   *
   * Measured: an 80px swipe delivered in three frames moved the map 35px —
   * exactly the last frame — and a slow, steady drag moves a few pixels and
   * returns, which is indistinguishable from a map that cannot be dragged at
   * all. That is what was reported. `TileMap.test.tsx` drives the gesture
   * through the props actually on the node, with a touch history shaped the
   * way the platform shapes one, and fails on the old code.
   *
   * Nothing here needs to change between renders, so nothing does: the
   * current position is read from refs.
   */
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claimed on move rather than on touch, so a tap still reaches the
        // markers underneath. A responder that grabs the gesture at
        // `onStartShouldSet` swallows every pin press on the map.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          // From here on the person is driving: a location fix that lands
          // mid-pan must not pull the view out from under them.
          takenOver.current = true;
          dragStart.current = { centre: centreRef.current, zoom: zoomRef.current };
        },
        onPanResponderMove: (_event, gesture) => {
          const from = dragStart.current;
          if (!from) return;
          // Always from where the drag began, never incrementally from the
          // last frame: accumulating deltas drifts, and the map ends up a
          // little behind the finger by the end of a long swipe.
          setCentre(panBy({ centre: from.centre, zoom: from.zoom, dx: gesture.dx, dy: gesture.dy }));
        },
        onPanResponderRelease: () => {
          dragStart.current = null;
        },
        onPanResponderTerminate: () => {
          dragStart.current = null;
        },
      }),
    [],
  );

  const tiles = useMemo(
    () =>
      size.width > 0
        ? tilesForViewport({ centre, zoom, width: size.width, height: size.height })
        : [],
    [centre, zoom, size.width, size.height],
  );

  /**
   * Measured over the tiles currently on screen rather than over every
   * failure ever seen, so the message appears while the map is broken and
   * goes away by itself the moment tiles start arriving again — no retry
   * button, no state to get stuck in.
   */
  const basemapUnavailable = useMemo(() => {
    if (tiles.length === 0) return false;
    const failed = tiles.filter((tile) =>
      failedTiles.has(tileUrl(tile.x, tile.y, tile.z)),
    ).length;
    return failed / tiles.length >= TILES_FAILED_BEFORE_SAYING_SO;
  }, [tiles, failedTiles]);

  const placed = useMemo(
    () =>
      size.width > 0
        ? markers.map((marker) => ({
            marker,
            at: screenPosition({
              point: marker.position,
              centre,
              zoom,
              width: size.width,
              height: size.height,
            }),
          }))
        : [],
    [markers, centre, zoom, size.width, size.height],
  );

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.frame,
        {
          height,
          borderRadius: radius.lg,
          backgroundColor: premium.background.secondary,
          borderColor: color.border,
        },
      ]}
      {...responder.panHandlers}
    >
      {tiles.map((tile) => (
        <Image
          key={`${tile.z}/${tile.x}/${tile.y}`}
          onError={() => noteTileFailed(tileUrl(tile.x, tile.y, tile.z))}
          // Identification, not decoration: a tile provider that cannot
          // tell who is calling is entitled to refuse, and OSM's policy
          // says it does. See `tileSource.ts`.
          source={{ uri: tileUrl(tile.x, tile.y, tile.z), headers: tileRequestHeaders() }}
          style={{
            position: 'absolute',
            left: tile.left,
            top: tile.top,
            width: TILE_SIZE,
            height: TILE_SIZE,
          }}
          // Tiles are opaque squares that tile exactly; fading each one in
          // makes a screenful arrive as a visible patchwork. (`expo-image`
          // spells React Native's `fadeDuration={0}` this way.)
          transition={0}
          // The reason this component uses `expo-image` at all. A pan or a
          // zoom asks for a screenful of tiles, and returning to a tile
          // already seen is the common case — React Native's `Image` gives a
          // memory cache and, on iOS, little more, so every revisit went back
          // over the network. These are immutable by URL: the same z/x/y is
          // the same square forever, which is exactly what a disk cache is
          // for, and it is also somebody's mobile data.
          cachePolicy="memory-disk"
        />
      ))}

      {/* v1 painted a translucent scrim here to darken OSM's light basemap
          for a near-black app. The app is light now (see
          `ThemeProvider.tsx`'s doc comment), so a light basemap needs no
          darkening — `light-premium.ts`'s `background.base` already made
          this scrim fully transparent, which is why it is gone rather than
          retuned: a `View` painting nothing at any opacity was dead code
          describing behaviour nobody saw. Nothing replaces it — the frame's
          own border and rounded corners are enough to separate the map from
          the rest of the screen. */}

      {basemapUnavailable && unavailableLabel ? (
        <View style={styles.unavailable} pointerEvents="none">
          <Text
            style={[text.caption, { color: color.textSecondary, textAlign: 'center' }]}
            accessibilityRole="text"
          >
            {unavailableLabel}
          </Text>
        </View>
      ) : null}

      {placed.map(({ marker, at }) => (
        <View
          key={marker.id}
          style={{ position: 'absolute', left: at.x, top: at.y }}
          pointerEvents="box-none"
        >
          {/* Translated by half its own size in the child rather than by a
              guessed offset here, so a marker of any shape stays centred on
              its coordinate. */}
          <View style={styles.markerAnchor} pointerEvents="box-none">
            <Pressable
              onPress={() => onSelect?.(marker.id)}
              hitSlop={10}
              accessibilityRole="button"
            >
              {marker.render(marker.id === selectedId)}
            </Pressable>
          </View>
        </View>
      ))}

      <View style={[styles.zoomStack, { right: space[3], top: space[3] }]}>
        {/*
          Back to where the map was told to look — which, once a location fix
          has arrived, is where the person is. Offered only after they have
          panned away, because before that it would do nothing and a control
          that does nothing teaches people not to trust the others.
        */}
        {takenOver.current ? (
          <ZoomButton
            icon="locate"
            label="◎"
            disabled={false}
            onPress={() => {
              takenOver.current = false;
              followed.current = `${initialCentre.lat},${initialCentre.lng}`;
              setCentre(initialCentre);
            }}
          />
        ) : null}
        <ZoomButton
          icon="add"
          label="+"
          onPress={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))}
          disabled={zoom >= MAX_ZOOM}
        />
        <ZoomButton
          icon="remove"
          label="−"
          onPress={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))}
          disabled={zoom <= MIN_ZOOM}
        />
      </View>

      {/* ODbL. Not decoration — see `tileSource.ts`. */}
      <Text
        style={[
          text.caption,
          styles.attribution,
          { color: color.textTertiary, backgroundColor: premium.glass.dark },
        ]}
      >
        {attribution()}
      </Text>
    </View>
  );
}

function ZoomButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { color, premium, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Zoom in' : 'Zoom out'}
      style={({ pressed }) => [
        styles.zoomButton,
        {
          borderRadius: radius.md,
          backgroundColor: premium.card.background,
          borderColor: premium.card.border,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={color.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  markerAnchor: { transform: [{ translateX: -18 }, { translateY: -36 }] },
  zoomStack: { position: 'absolute', gap: 8 },
  zoomButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  attribution: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  unavailable: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
