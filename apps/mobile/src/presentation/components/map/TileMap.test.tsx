import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { TileMap } from './TileMap';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

/**
 * What a customer sees when the basemap will not load.
 *
 * Until this existed, every failure mode of the tile provider — no network,
 * a revoked key, a quota reached — rendered the same thing: an empty
 * rectangle, indistinguishable from a part of Yerevan with no partners in
 * it. The wrong conclusion was the easy one to draw.
 */
const LABEL = 'The map is unavailable right now.';

function renderMap(props: Partial<React.ComponentProps<typeof TileMap>> = {}) {
  const view = render(
    <ThemeProvider>
      <TileMap
        markers={[]}
        initialCentre={{ lat: 40.1772, lng: 44.5035 }}
        unavailableLabel={LABEL}
        {...props}
      />
    </ThemeProvider>,
  );
  // The map draws nothing until it has measured itself.
  act(() => {
    fireEvent(screen.UNSAFE_getByType(View), 'layout', {
      nativeEvent: { layout: { width: 320, height: 260 } },
    });
  });
  return view;
}

function tileImages() {
  return screen.UNSAFE_queryAllByType(Image);
}

describe('TileMap when the basemap fails', () => {
  it('says nothing while the tiles are arriving', () => {
    renderMap();
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('still says nothing when a single tile drops', () => {
    // One missing square is a dropped request. The map reads correctly around
    // it, and a warning there would cry wolf on every flaky connection.
    renderMap();
    const tiles = tileImages();
    expect(tiles.length).toBeGreaterThan(2);
    act(() => {
      fireEvent(tiles[0], 'error');
    });
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('names the failure once most of the screenful is gone', () => {
    renderMap();
    const tiles = tileImages();
    act(() => {
      for (const tile of tiles) fireEvent(tile, 'error');
    });
    expect(screen.getByText(LABEL)).toBeTruthy();
  });

  it('stays silent when no label was supplied, rather than inventing one', () => {
    renderMap({ unavailableLabel: undefined });
    const tiles = tileImages();
    act(() => {
      for (const tile of tiles) fireEvent(tile, 'error');
    });
    expect(screen.queryByText(LABEL)).toBeNull();
  });
});

/**
 * Dragging the map with a finger.
 *
 * There were no tests here at all, which is how a map that cannot be panned
 * reached a release. Two things have to be imitated faithfully, and both are
 * the point:
 *
 * 1. **React Native's responder system dispatches to the handlers currently
 *    on the node's props.** So each step below re-reads `panHandlers` from
 *    the freshly rendered element rather than holding the object it got at
 *    the start. A test that captures the handlers once tests a component
 *    that does not exist.
 * 2. **`PanResponder` computes `dx`/`dy` from `event.touchHistory`,** not
 *    from anything the caller passes. Feeding it a bare `pageX` would let a
 *    broken component pass, because the numbers would come from the test
 *    instead of from the responder.
 */
function mapFrame() {
  return screen.UNSAFE_getByType(View);
}

/** The tile offsets are what actually moves on screen. */
function firstTilePosition() {
  const tile = tileImages()[0];
  return { left: tile.props.style.left, top: tile.props.style.top };
}

const TOUCH_ID = 1;

/**
 * A moving finger, recorded the way the platform records one.
 *
 * `previous*` has to be the position at the *previous* frame, not the current
 * one: `PanResponder` derives each step from the difference between them. A
 * history where previous equals current makes every per-frame delta zero,
 * which would let a broken component look merely sluggish instead of stuck —
 * and would make this test a description of the test rather than of the map.
 */
function finger(x0: number, y0: number) {
  let prevX = x0;
  let prevY = y0;
  let prevT = 0;
  let clock = 0;

  return function at(dx: number, dy: number) {
    const x = x0 + dx;
    const y = y0 + dy;
    clock += 16;
    const bank: unknown[] = [];
    bank[TOUCH_ID] = {
      touchActive: true,
      startPageX: x0,
      startPageY: y0,
      startTimeStamp: 0,
      currentPageX: x,
      currentPageY: y,
      currentTimeStamp: clock,
      previousPageX: prevX,
      previousPageY: prevY,
      previousTimeStamp: prevT,
    };
    prevX = x;
    prevY = y;
    prevT = clock;
    return {
      nativeEvent: {
        identifier: TOUCH_ID,
        pageX: x,
        pageY: y,
        touches: [{ identifier: TOUCH_ID, pageX: x, pageY: y }],
        changedTouches: [],
      },
      touchHistory: {
        touchBank: bank,
        numberActiveTouches: 1,
        indexOfSingleActiveTouch: TOUCH_ID,
        mostRecentTimeStamp: clock,
      },
    };
  };
}

function drag(steps: Array<{ dx: number; dy: number }>) {
  const x0 = 160;
  const y0 = 130;
  const at = finger(x0, y0);

  act(() => {
    const h = mapFrame().props;
    h.onStartShouldSetResponder?.(at(0, 0));
    h.onMoveShouldSetResponder?.(at(steps[0].dx, steps[0].dy));
    h.onResponderGrant?.(at(0, 0));
  });

  for (const step of steps) {
    act(() => {
      // Deliberately re-read from the current props every time.
      mapFrame().props.onResponderMove?.(at(step.dx, step.dy));
    });
  }

  const last = steps[steps.length - 1];
  act(() => {
    mapFrame().props.onResponderRelease?.(at(last.dx, last.dy));
  });
}

describe('dragging the map', () => {
  it('follows the finger across a multi-step drag', () => {
    renderMap();
    const before = firstTilePosition();

    // One continuous swipe left, reported as the running total from the
    // start of the gesture — which is what `gestureState.dx` is.
    drag([
      { dx: -20, dy: 0 },
      { dx: -45, dy: 0 },
      { dx: -80, dy: 0 },
    ]);

    const after = firstTilePosition();
    expect(after.left).toBeCloseTo(before.left - 80, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
  });
});

describe('the map keeps the place the person put it', () => {
  const PINS = [
    { id: 'a', position: { lat: 40.18, lng: 44.51 }, render: () => <View /> },
    { id: 'b', position: { lat: 40.19, lng: 44.52 }, render: () => <View /> },
  ];

  it('is not yanked away by a location fix that lands after the drag', () => {
    const { rerender } = renderMap();
    drag([{ dx: -30, dy: -20 }, { dx: -60, dy: -40 }]);
    const afterDrag = firstTilePosition();

    // The real sequence: the app opens on the city centre, the person drags,
    // and the GPS fix arrives seconds later with somewhere else entirely.
    act(() => {
      rerender(
        <ThemeProvider>
          <TileMap
            markers={[]}
            initialCentre={{ lat: 40.25, lng: 44.6 }}
            unavailableLabel={LABEL}
          />
        </ThemeProvider>,
      );
    });

    expect(firstTilePosition()).toEqual(afterDrag);
  });

  it('does not reframe onto new markers once the person has dragged', () => {
    // The markers change for reasons that have nothing to do with the map:
    // the nearby query re-runs when the device's own fix moves. Refitting
    // then would undo the drag — the same symptom as a map that will not
    // move, arriving by a different route.
    const { rerender } = renderMap({ markers: PINS });
    drag([{ dx: -40, dy: 0 }, { dx: -90, dy: 0 }]);
    const afterDrag = firstTilePosition();

    act(() => {
      rerender(
        <ThemeProvider>
          <TileMap
            markers={[...PINS, { id: 'c', position: { lat: 40.3, lng: 44.7 }, render: () => <View /> }]}
            initialCentre={{ lat: 40.1772, lng: 44.5035 }}
            unavailableLabel={LABEL}
          />
        </ThemeProvider>,
      );
    });

    expect(firstTilePosition()).toEqual(afterDrag);
  });

  it('does reframe when the person asks a different question', () => {
    // The other half of the same rule, and the one that would silently rot:
    // a fix that only ever refuses to reframe would pass the test above and
    // leave the category chips pointing at a view of somewhere else.
    const { rerender } = renderMap({ markers: PINS, frameKey: 'all::' });
    drag([{ dx: -40, dy: 0 }, { dx: -90, dy: 0 }]);
    const afterDrag = firstTilePosition();

    act(() => {
      rerender(
        <ThemeProvider>
          <TileMap
            markers={[{ id: 'z', position: { lat: 40.4, lng: 44.9 }, render: () => <View /> }]}
            frameKey="category:restaurant:"
            initialCentre={{ lat: 40.1772, lng: 44.5035 }}
            unavailableLabel={LABEL}
          />
        </ThemeProvider>,
      );
    });

    expect(firstTilePosition()).not.toEqual(afterDrag);
  });
});

describe('the map controls', () => {
  it('offers a way back only after the person has moved the map', () => {
    renderMap();
    expect(screen.queryByLabelText('Show my location')).toBeNull();

    drag([{ dx: -50, dy: -30 }, { dx: -110, dy: -70 }]);

    expect(screen.getByLabelText('Show my location')).toBeTruthy();
  });

  it('goes back to where the person is when asked', () => {
    renderMap();
    const home = firstTilePosition();
    drag([{ dx: -50, dy: -30 }, { dx: -110, dy: -70 }]);
    expect(firstTilePosition()).not.toEqual(home);

    act(() => {
      fireEvent.press(screen.getByLabelText('Show my location'));
    });

    expect(firstTilePosition()).toEqual(home);
    // And the control retires itself, because there is nothing to go back to.
    expect(screen.queryByLabelText('Show my location')).toBeNull();
  });

  it('says what each control does rather than what it looks like', () => {
    // Regression: the label used to be inferred from the glyph — anything
    // that was not "+" announced itself as "Zoom out". The recentre button
    // therefore promised a screen-reader user it would zoom out and then
    // moved the map instead.
    renderMap();
    drag([{ dx: -50, dy: -30 }, { dx: -110, dy: -70 }]);

    expect(screen.getByLabelText('Zoom in')).toBeTruthy();
    expect(screen.getByLabelText('Zoom out')).toBeTruthy();
    expect(screen.getByLabelText('Show my location')).toBeTruthy();
  });

  it('still lets a tap reach a pin underneath', () => {
    // Why the responder claims on move and not on touch. If this breaks,
    // the map is draggable and every pin is dead.
    const onSelect = jest.fn();
    renderMap({
      markers: [{ id: 'a', position: { lat: 40.1772, lng: 44.5035 }, render: () => <View /> }],
      onSelect,
    });

    const frame = mapFrame().props;
    expect(frame.onStartShouldSetResponder?.({ nativeEvent: {} })).toBeFalsy();
  });
});

/**
 * Two fingers.
 *
 * The map had no pinch at all — the only way to zoom was the pair of
 * buttons — and that was reported as "I cannot zoom with my fingers". The
 * responder is driven the same way as the drag above: through the props on
 * the node, with a touch history holding two active touches, which is what
 * `PanResponder` reads `numberActiveTouches` from.
 */
function twoFingers(a0: { x: number; y: number }, b0: { x: number; y: number }) {
  let prev = [a0, b0];
  let prevT = 0;
  let clock = 0;
  const ids = [1, 2];

  return function at(a: { x: number; y: number }, b: { x: number; y: number }) {
    clock += 16;
    const bank: unknown[] = [];
    [a, b].forEach((p, i) => {
      bank[ids[i]] = {
        touchActive: true,
        startPageX: i === 0 ? a0.x : b0.x,
        startPageY: i === 0 ? a0.y : b0.y,
        startTimeStamp: 0,
        currentPageX: p.x,
        currentPageY: p.y,
        currentTimeStamp: clock,
        previousPageX: prev[i].x,
        previousPageY: prev[i].y,
        previousTimeStamp: prevT,
      };
    });
    prev = [a, b];
    prevT = clock;
    return {
      nativeEvent: {
        identifier: ids[0],
        pageX: a.x,
        pageY: a.y,
        touches: [
          { identifier: ids[0], pageX: a.x, pageY: a.y },
          { identifier: ids[1], pageX: b.x, pageY: b.y },
        ],
        changedTouches: [],
      },
      touchHistory: {
        touchBank: bank,
        numberActiveTouches: 2,
        indexOfSingleActiveTouch: ids[0],
        mostRecentTimeStamp: clock,
      },
    };
  };
}

/**
 * Where a marker's anchor sits: the nearest ancestor positioned absolutely,
 * which is the view `TileMap` places at the projected point.
 */
function markerOffset(testID: string): { left: number; top: number } {
  let node = screen.getByTestId(testID).parent;
  while (node) {
    const style = StyleSheet.flatten(node.props.style) as { position?: string; left?: number; top?: number } | undefined;
    if (style?.position === 'absolute' && typeof style.left === 'number' && typeof style.top === 'number') {
      return { left: style.left, top: style.top };
    }
    node = node.parent;
  }
  throw new Error(`marker ${testID} is not positioned`);
}

/** The level the tiles are drawn from and the size they are drawn at. */
function tileLevel() {
  const tile = tileImages()[0];
  return { z: Number(String(tile.props.source.uri).match(/\/(\d+)\/\d+\/\d+/)?.[1]), size: tile.props.style.width };
}

function pinch(from: [{ x: number; y: number }, { x: number; y: number }], to: [{ x: number; y: number }, { x: number; y: number }], steps = 3) {
  const at = twoFingers(from[0], from[1]);
  act(() => {
    const h = mapFrame().props;
    expect(h.onStartShouldSetResponder?.(at(from[0], from[1]))).toBe(true);
    h.onResponderGrant?.(at(from[0], from[1]));
  });
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    const a = { x: from[0].x + (to[0].x - from[0].x) * k, y: from[0].y + (to[0].y - from[0].y) * k };
    const b = { x: from[1].x + (to[1].x - from[1].x) * k, y: from[1].y + (to[1].y - from[1].y) * k };
    act(() => {
      mapFrame().props.onResponderMove?.(at(a, b));
    });
  }
  act(() => {
    mapFrame().props.onResponderRelease?.(at(to[0], to[1]));
  });
}

describe('pinching the map', () => {
  it('zooms in when the fingers spread and out when they close', () => {
    renderMap();
    const start = tileLevel();
    expect(start).toEqual({ z: 13, size: 256 });

    // Spread to twice the distance: exactly one level in.
    pinch([{ x: 140, y: 130 }, { x: 180, y: 130 }], [{ x: 120, y: 130 }, { x: 200, y: 130 }]);
    const spread = tileLevel();
    expect(spread.z).toBe(14);
    expect(spread.size).toBeCloseTo(256, 3);

    // Close to a quarter of that distance: two levels out from there.
    pinch([{ x: 120, y: 130 }, { x: 200, y: 130 }], [{ x: 150, y: 130 }, { x: 170, y: 130 }]);
    expect(tileLevel().z).toBe(12);
  });

  it('draws the in-between zooms by scaling the nearest level', () => {
    renderMap();
    // 1.3× the distance is 0.38 of a level — nearer 13, drawn larger.
    pinch([{ x: 110, y: 130 }, { x: 210, y: 130 }], [{ x: 95, y: 130 }, { x: 225, y: 130 }]);
    const between = tileLevel();
    expect(between.z).toBe(13);
    expect(between.size).toBeCloseTo(256 * 1.3, 3);
  });

  it('keeps the place between the fingers between the fingers', () => {
    // The pin sits where the fingers meet. After the pinch it must still be
    // there, or the map zoomed onto somewhere else than what was pinched.
    const pin = { id: 'p', position: { lat: 40.1772, lng: 44.5035 }, render: () => <View testID="pin" /> };
    renderMap({ markers: [pin] });
    const before = markerOffset('pin');
    // The pin is at the centre, and the frame is at the window's origin in
    // this renderer, so the fingers straddle the centre of the viewport.
    pinch([{ x: 130, y: 130 }, { x: 190, y: 130 }], [{ x: 100, y: 130 }, { x: 220, y: 130 }]);
    const after = markerOffset('pin');
    expect(after.left).toBeCloseTo(before.left, 3);
    expect(after.top).toBeCloseTo(before.top, 3);
  });

  it('carries a drag on with the finger that stays', () => {
    renderMap();
    pinch([{ x: 140, y: 130 }, { x: 180, y: 130 }], [{ x: 120, y: 130 }, { x: 200, y: 130 }]);
    const afterPinch = firstTilePosition();

    // The second finger lifts; the first carries on 40px to the left. The
    // responder's running dx by then includes the whole pinch, so a map that
    // measured from touch-down would jump.
    drag([{ dx: -20, dy: 0 }, { dx: -40, dy: 0 }]);
    expect(firstTilePosition().left).toBeCloseTo(afterPinch.left - 40, 0);
  });

  it('stops at the last level rather than drifting', () => {
    renderMap({ initialZoom: 18 });
    const before = firstTilePosition();
    pinch([{ x: 140, y: 130 }, { x: 180, y: 130 }], [{ x: 100, y: 130 }, { x: 220, y: 130 }]);
    expect(tileLevel().z).toBe(18);
    expect(firstTilePosition()).toEqual(before);
  });

  it('is offered a two-finger touch before it moves', () => {
    // A pinch that could only begin after the fingers had travelled 3px
    // would start with a jump; two fingers cannot be a tap on a pin.
    renderMap();
    const at = twoFingers({ x: 140, y: 130 }, { x: 180, y: 130 });
    expect(mapFrame().props.onStartShouldSetResponder?.(at({ x: 140, y: 130 }, { x: 180, y: 130 }))).toBe(true);
  });
});

describe('tapping the map', () => {
  function tap(x: number, y: number, timestamp: number) {
    const event = { nativeEvent: { pageX: x, pageY: y, timestamp, touches: [], changedTouches: [] } };
    act(() => {
      mapFrame().props.onTouchStart?.({ nativeEvent: { ...event.nativeEvent, touches: [{ pageX: x, pageY: y }] } });
      mapFrame().props.onTouchEnd?.(event);
    });
  }

  it('zooms in one level on a double-tap, about the tap', () => {
    const pin = { id: 'p', position: { lat: 40.1772, lng: 44.5035 }, render: () => <View testID="pin" /> };
    renderMap({ markers: [pin] });
    expect(tileLevel().z).toBe(13);
    // Twice on the pin, which sits at the centre of a 320×260 map.
    tap(160, 130, 1000);
    tap(162, 131, 1200);
    expect(tileLevel().z).toBe(14);
    // Zoomed about the second tap: what was 2px left and 1px above it is
    // now twice as far from it, and nothing else has moved.
    const at = markerOffset('pin');
    expect(at.left).toBeCloseTo(162 - 2 * 2, 3);
    expect(at.top).toBeCloseTo(131 - 2 * 1, 3);
  });

  it('does not treat two slow taps as one double-tap', () => {
    renderMap();
    tap(160, 130, 1000);
    tap(160, 130, 1600);
    expect(tileLevel().z).toBe(13);
  });

  it('tells the parent while a finger is down, so a list around it can hold still', () => {
    const onInteractionChange = jest.fn();
    renderMap({ onInteractionChange });
    act(() => {
      mapFrame().props.onTouchStart?.({ nativeEvent: { pageX: 1, pageY: 1, touches: [{ pageX: 1, pageY: 1 }] } });
    });
    expect(onInteractionChange).toHaveBeenLastCalledWith(true);
    act(() => {
      // A second finger lands and lifts: still one interaction.
      mapFrame().props.onTouchStart?.({ nativeEvent: { pageX: 5, pageY: 5, touches: [{ pageX: 1, pageY: 1 }, { pageX: 5, pageY: 5 }] } });
      mapFrame().props.onTouchEnd?.({ nativeEvent: { pageX: 5, pageY: 5, touches: [{ pageX: 1, pageY: 1 }] } });
    });
    expect(onInteractionChange).toHaveBeenCalledTimes(1);
    act(() => {
      mapFrame().props.onTouchEnd?.({ nativeEvent: { pageX: 1, pageY: 1, touches: [] } });
    });
    expect(onInteractionChange).toHaveBeenLastCalledWith(false);
    expect(onInteractionChange).toHaveBeenCalledTimes(2);
  });
});
