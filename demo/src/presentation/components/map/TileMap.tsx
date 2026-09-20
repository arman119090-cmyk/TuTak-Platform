import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import {
  fitBounds,
  panBy,
  screenPosition,
  tilesForViewport,
  zoomAround,
  type LatLng,
  type WorldPoint,
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
 * Two taps this close together, in time and in place, are one double-tap.
 *
 * 300 ms is what every platform's own tap detection uses; the distance is
 * generous because a thumb does not land twice on the same pixel.
 */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_RADIUS = 24;

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
  onInteractionChange,
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
  /**
   * Told `true` when a finger lands on the map and `false` when the last one
   * lifts. A parent that scrolls — the partners list does — uses it to stop
   * scrolling for the duration, because on Android a vertical drag on the
   * map is otherwise taken by the list before the map sees it, and a map
   * that only pans sideways reads as a map that does not pan.
   */
  onInteractionChange?: (active: boolean) => void;
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

  /**
   * The gesture in progress, read and written between renders, so a ref:
   * routing it through state would re-render on every one of the sixty
   * frames a drag produces and re-fetch the tile grid each time.
   *
   * `drag` is where a one-finger pan started, plus the responder's running
   * `dx`/`dy` at that moment — zero for a drag that began on touch, and
   * whatever the responder had accumulated when a pinch ended and the last
   * finger carried on alone. `pinch` is where a two-finger pinch started:
   * the map's centre and zoom, the distance between the fingers and the
   * point between them, all relative to the start so nothing drifts.
   */
  const gesture = useRef<{
    drag: { centre: LatLng; zoom: number; dx0: number; dy0: number } | null;
    pinch: { centre: LatLng; zoom: number; distance: number; mid: WorldPoint } | null;
  }>({ drag: null, pinch: null });

  /**
   * Where the map's frame sits in the window, so a finger's `pageX`/`pageY`
   * can be turned into a point on the map. Measured on layout and again on
   * every touch-down, because a list scrolls the map around the screen
   * between layouts. Unmeasurable — a test renderer, a detached view — it
   * stays at the origin and a pinch zooms about the map's centre, which is
   * wrong by a little rather than broken.
   */
  const frameRef = useRef<View>(null);
  const frameOrigin = useRef<WorldPoint>({ x: 0, y: 0 });
  const measureFrame = useCallback(() => {
    frameRef.current?.measureInWindow?.((x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) frameOrigin.current = { x, y };
    });
  }, []);
  // Both read refs only, so both are stable: the responder below is built
  // once and must not be rebuilt for them (see its comment).
  const toFrame = useCallback(
    (pageX: number, pageY: number): WorldPoint => ({
      x: pageX - frameOrigin.current.x,
      y: pageY - frameOrigin.current.y,
    }),
    [],
  );
  /** The first two fingers on the map: how far apart, and the point between them. */
  const fingers = useCallback(
    (event: GestureResponderEvent): { distance: number; mid: WorldPoint } | null => {
      const touches = event.nativeEvent.touches ?? [];
      if (touches.length < 2) return null;
      const [a, b] = touches;
      return {
        distance: Math.hypot(b.pageX - a.pageX, b.pageY - a.pageY),
        mid: toFrame((a.pageX + b.pageX) / 2, (a.pageY + b.pageY) / 2),
      };
    },
    [toFrame],
  );

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
  const sizeRef = useRef(size);
  centreRef.current = centre;
  zoomRef.current = zoom;
  sizeRef.current = size;

  /**
   * Zoom so that the place under `focal` stays under `focal`. Every way of
   * zooming goes through here — the pinch, the double-tap and the buttons
   * (which zoom about the middle) — so they cannot disagree about the limits.
   */
  const zoomTo = useCallback((toZoom: number, focal?: WorldPoint) => {
    const { width, height: h } = sizeRef.current;
    const next = zoomAround({
      centre: centreRef.current,
      zoom: zoomRef.current,
      toZoom,
      focal: focal ?? { x: width / 2, y: h / 2 },
      width,
      height: h,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    });
    setCentre(next.centre);
    setZoom(next.zoom);
  }, []);

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

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height: h } = event.nativeEvent.layout;
      setSize((prev) => (prev.width === width && prev.height === h ? prev : { width, height: h }));
      measureFrame();
    },
    [measureFrame],
  );

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
        // `onStartShouldSet` swallows every pin press on the map. Two
        // fingers are the exception: nobody taps a pin with two fingers,
        // and a pinch that had to move first would start with a jump.
        // Counted on the event: the responder's own `numberActiveTouches`
        // is only brought up to date once a gesture has been granted.
        onStartShouldSetPanResponder: (event) => (event.nativeEvent.touches?.length ?? 0) >= 2,
        onMoveShouldSetPanResponder: (_event, state) =>
          state.numberActiveTouches >= 2 || Math.abs(state.dx) > 3 || Math.abs(state.dy) > 3,
        // Once the map has the gesture it keeps it. The list around it asks
        // for every vertical drag, and a map that hands those over cannot be
        // panned up or down.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          // From here on the person is driving: a location fix that lands
          // mid-pan must not pull the view out from under them.
          takenOver.current = true;
          gesture.current = {
            drag: { centre: centreRef.current, zoom: zoomRef.current, dx0: 0, dy0: 0 },
            pinch: null,
          };
          // Granted with two fingers already down: the pinch measures from
          // here. Taking the baseline from the first *move* instead lost
          // whatever the fingers did before it — a spread to twice the
          // distance came out as a spread to one and a half.
          const pair = fingers(event);
          if (pair) gesture.current = { drag: null, pinch: { centre: centreRef.current, zoom: zoomRef.current, ...pair } };
        },
        onPanResponderMove: (event, state) => {
          const current = gesture.current;
          const pair = fingers(event);

          if (pair) {
            const { distance, mid } = pair;
            if (!current.pinch) {
              // The second finger has just landed: this frame is the
              // baseline, and there is nothing to apply yet.
              current.pinch = { centre: centreRef.current, zoom: zoomRef.current, distance, mid };
              current.drag = null;
              return;
            }
            const from = current.pinch;
            if (from.distance <= 0) return;
            // Spreading the fingers to twice the distance is one level in;
            // the place between them stays between them; and if the pair
            // has moved as a whole, the map has moved with it.
            const { width, height: h } = sizeRef.current;
            const zoomed = zoomAround({
              centre: from.centre,
              zoom: from.zoom,
              toZoom: from.zoom + Math.log2(distance / from.distance),
              focal: from.mid,
              width,
              height: h,
              minZoom: MIN_ZOOM,
              maxZoom: MAX_ZOOM,
            });
            setCentre(
              panBy({
                centre: zoomed.centre,
                zoom: zoomed.zoom,
                dx: mid.x - from.mid.x,
                dy: mid.y - from.mid.y,
              }),
            );
            setZoom(zoomed.zoom);
            return;
          }

          if (current.pinch) {
            // One finger has lifted and the other carries on. The responder's
            // `dx`/`dy` kept counting through the pinch, so the drag that
            // follows measures from here rather than from the touch-down.
            current.pinch = null;
            current.drag = {
              centre: centreRef.current,
              zoom: zoomRef.current,
              dx0: state.dx,
              dy0: state.dy,
            };
            return;
          }

          const from = current.drag;
          if (!from) return;
          // Always from where the drag began, never incrementally from the
          // last frame: accumulating deltas drifts, and the map ends up a
          // little behind the finger by the end of a long swipe.
          setCentre(
            panBy({
              centre: from.centre,
              zoom: from.zoom,
              dx: state.dx - from.dx0,
              dy: state.dy - from.dy0,
            }),
          );
        },
        onPanResponderRelease: () => {
          gesture.current = { drag: null, pinch: null };
        },
        onPanResponderTerminate: () => {
          gesture.current = { drag: null, pinch: null };
        },
      }),
    [fingers],
  );

  /**
   * Touches, below the responder system.
   *
   * These fire for every finger that lands on the frame or anything in it,
   * whether or not the responder claims the gesture, which makes them the
   * right place for two things the responder cannot do: tell the parent a
   * finger is down *before* the parent's own scroll view has decided to take
   * the drag, and see the taps the responder deliberately leaves alone —
   * two of which, close together, zoom in on where they landed.
   */
  const touching = useRef(false);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const onTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      measureFrame();
      if ((event.nativeEvent.touches?.length ?? 0) > 1) lastTap.current = null;
      if (!touching.current) {
        touching.current = true;
        onInteractionChange?.(true);
      }
    },
    [measureFrame, onInteractionChange],
  );
  const onTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      if ((event.nativeEvent.touches?.length ?? 0) > 0) return;
      touching.current = false;
      onInteractionChange?.(false);

      // A tap is a touch that the responder never claimed: a drag or a
      // pinch cleared this on release before the finger came up.
      const wasGesture = gesture.current.drag !== null || gesture.current.pinch !== null;
      if (wasGesture) {
        lastTap.current = null;
        return;
      }
      const { pageX, pageY, timestamp } = event.nativeEvent;
      const now = typeof timestamp === 'number' ? timestamp : Date.now();
      const previous = lastTap.current;
      if (
        previous &&
        now - previous.at <= DOUBLE_TAP_MS &&
        Math.hypot(pageX - previous.x, pageY - previous.y) <= DOUBLE_TAP_RADIUS
      ) {
        lastTap.current = null;
        takenOver.current = true;
        zoomTo(Math.floor(zoomRef.current) + 1, toFrame(pageX, pageY));
        return;
      }
      lastTap.current = { at: now, x: pageX, y: pageY };
    },
    [onInteractionChange, zoomTo, toFrame],
  );
  const onTouchCancel = useCallback(() => {
    touching.current = false;
    lastTap.current = null;
    onInteractionChange?.(false);
  }, [onInteractionChange]);

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
      ref={frameRef}
      onLayout={onLayout}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
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
            width: tile.size,
            height: tile.size,
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

      {/* A scrim over the tiles, coloured by the theme: transparent on the
          light scheme (`light-premium.ts` sets `background.base` so), a
          low-opacity ink wash on the dark one (`dark-premium.ts`), where an
          OSM basemap would otherwise be a bright rectangle in a dark UI.
          Under the markers and the controls, so those keep full contrast;
          `pointerEvents="none"` so it never takes a touch. */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: premium.background.base }]}
      />

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
            accessibilityLabel="Show my location"
            disabled={false}
            onPress={() => {
              takenOver.current = false;
              followed.current = `${initialCentre.lat},${initialCentre.lng}`;
              setCentre(initialCentre);
            }}
          />
        ) : null}
        {/* The buttons land on whole levels: from 13.4, "in" goes to 14 and
            "out" to 13, so a pinch left half-way is tidied rather than
            carried on as 14.4. */}
        <ZoomButton
          icon="add"
          accessibilityLabel="Zoom in"
          onPress={() => zoomTo(Math.floor(zoom) + 1)}
          disabled={zoom >= MAX_ZOOM}
        />
        <ZoomButton
          icon="remove"
          accessibilityLabel="Zoom out"
          onPress={() => zoomTo(Math.ceil(zoom) - 1)}
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
  accessibilityLabel,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  /**
   * What the button *does*, said out loud.
   *
   * This used to be derived from a `label` prop holding the glyph —
   * `label === '+' ? 'Zoom in' : 'Zoom out'` — so every button that was not
   * the plus announced itself as "Zoom out". The recentre button (`◎`)
   * therefore promised a screen-reader user it would zoom out and then moved
   * the map somewhere else instead.
   *
   * The `label` prop is gone rather than renamed: it was never rendered —
   * the button draws only the icon — so its sole purpose was to be guessed
   * from. A control has to say what it does, and saying it is cheaper than
   * inferring it.
   */
  accessibilityLabel: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { color, premium, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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
