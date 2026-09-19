import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
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
