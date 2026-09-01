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
import { ATTRIBUTION, tileUrl } from './tileSource';

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

export function TileMap({
  markers,
  initialCentre,
  initialZoom = 13,
  selectedId,
  onSelect,
  height = 260,
}: {
  markers: MapMarker[];
  initialCentre: LatLng;
  initialZoom?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const { color, radius, space, text, premium } = useTheme();

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [centre, setCentre] = useState<LatLng>(initialCentre);
  const [zoom, setZoom] = useState(initialZoom);

  // The pan is read and written between renders, so it is a ref: routing it
  // through state would re-render on every one of the sixty frames a drag
  // produces and re-fetch the tile grid each time.
  const dragStart = useRef<{ centre: LatLng; zoom: number } | null>(null);

  // What the map was last told to fit. A screen whose results change — a
  // category chip, a search — should reframe; a screen the user has just
  // dragged should not be yanked back. Keyed on the markers themselves.
  const fitted = useRef<string | null>(null);
  const markerKey = markers.map((m) => m.id).join('|');

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height: h } = event.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === h ? prev : { width, height: h }));
  }, []);

  // Frame the pins as soon as there is both a viewport and something to show.
  // Done during render rather than in an effect so the first painted frame is
  // already framed — an effect would show one frame at the default centre and
  // then jump, which reads as the map having lost its place.
  if (size.width > 0 && markers.length > 0 && fitted.current !== markerKey) {
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
          dragStart.current = { centre, zoom };
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
    [centre, zoom],
  );

  const tiles = useMemo(
    () =>
      size.width > 0
        ? tilesForViewport({ centre, zoom, width: size.width, height: size.height })
        : [],
    [centre, zoom, size.width, size.height],
  );

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
          source={{ uri: tileUrl(tile.x, tile.y, tile.z) }}
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
        {ATTRIBUTION}
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
});
