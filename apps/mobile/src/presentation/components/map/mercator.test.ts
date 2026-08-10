import {
  fitBounds,
  panBy,
  project,
  screenPosition,
  tilesForViewport,
  TILE_SIZE,
  unproject,
  worldSize,
} from './mercator';

/**
 * The map is arithmetic, so this is where it is checked.
 *
 * A projection mistake does not throw. It draws a map that looks like a map,
 * with every pin a few streets from where it belongs — worse at higher
 * latitudes, which is all of Armenia. The numbers below are the ones a wrong
 * implementation gets wrong.
 */

// Republic Square, Yerevan. Far enough north that the latitude term matters:
// a linear approximation is out by kilometres here and by nothing at all at
// the equator, which is why no test in this file uses the equator alone.
const YEREVAN = { lat: 40.1776, lng: 44.5126 };

describe('project', () => {
  it('sends (0, 0) to the middle of the world', () => {
    const size = worldSize(0);
    expect(project({ lat: 0, lng: 0 }, 0)).toEqual({ x: size / 2, y: size / 2 });
  });

  it('sends the antimeridian to the edges', () => {
    expect(project({ lat: 0, lng: -180 }, 3).x).toBeCloseTo(0, 6);
    expect(project({ lat: 0, lng: 180 }, 3).x).toBeCloseTo(worldSize(3), 6);
  });

  it('doubles with every zoom level', () => {
    const low = project(YEREVAN, 5);
    const high = project(YEREVAN, 6);
    expect(high.x).toBeCloseTo(low.x * 2, 6);
    expect(high.y).toBeCloseTo(low.y * 2, 6);
  });

  it('is not linear in latitude', () => {
    // Equal steps in degrees are unequal steps in pixels. If they were equal,
    // the projection has been written as a lerp and every pin is wrong.
    const size = worldSize(4);
    const a = size / 2 - project({ lat: 20, lng: 0 }, 4).y;
    const b = project({ lat: 40, lng: 0 }, 4).y - project({ lat: 20, lng: 0 }, 4).y;
    expect(Math.abs(b)).toBeGreaterThan(Math.abs(a) * 1.05);
  });

  it('clamps rather than diverging at the poles', () => {
    const size = worldSize(2);
    // Within a millionth of a pixel of the edge, not exactly on it: the cut
    // latitude is an irrational constant and `log((1+sin)/(1-sin))` lands a
    // few float ulps either side of it. Asserting equality here would be
    // asserting a property of the FPU, not of the projection.
    expect(project({ lat: 90, lng: 0 }, 2).y).toBeCloseTo(0, 6);
    expect(project({ lat: -90, lng: 0 }, 2).y).toBeCloseTo(size, 6);
    expect(Number.isFinite(project({ lat: 90, lng: 0 }, 2).y)).toBe(true);
  });
});

describe('unproject', () => {
  it('is the exact inverse of project', () => {
    for (const point of [YEREVAN, { lat: -33.86, lng: 151.2 }, { lat: 0, lng: 0 }]) {
      const round = unproject(project(point, 12), 12);
      expect(round.lat).toBeCloseTo(point.lat, 9);
      expect(round.lng).toBeCloseTo(point.lng, 9);
    }
  });
});

describe('tilesForViewport', () => {
  const viewport = { centre: YEREVAN, zoom: 13, width: 360, height: 240 };

  it('covers the viewport completely', () => {
    const tiles = tilesForViewport({ ...viewport, overscan: 0 });

    // Every corner of the screen has to land inside some tile. A gap here is
    // a stripe of background across the map.
    for (const [x, y] of [
      [0, 0],
      [viewport.width - 1, 0],
      [0, viewport.height - 1],
      [viewport.width - 1, viewport.height - 1],
    ] as const) {
      const covering = tiles.find(
        (t) => x >= t.left && x < t.left + TILE_SIZE && y >= t.top && y < t.top + TILE_SIZE,
      );
      expect(covering).toBeDefined();
    }
  });

  it('fetches a ring beyond the edges so a drag reveals map', () => {
    const bare = tilesForViewport({ ...viewport, overscan: 0 });
    const padded = tilesForViewport({ ...viewport, overscan: 1 });
    expect(padded.length).toBeGreaterThan(bare.length);
  });

  it('addresses every tile within the world at that zoom', () => {
    const span = 2 ** 13;
    for (const tile of tilesForViewport(viewport)) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(span);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(span);
    }
  });

  it('wraps columns around the antimeridian instead of drawing an edge', () => {
    const tiles = tilesForViewport({
      centre: { lat: 0, lng: 179.99 },
      zoom: 4,
      width: 360,
      height: 240,
    });
    // Some tile from the far west of the world appears beside the far east.
    expect(tiles.some((t) => t.x === 0)).toBe(true);
    expect(tiles.some((t) => t.x === 2 ** 4 - 1)).toBe(true);
  });

  it('asks for nothing above the north pole', () => {
    const tiles = tilesForViewport({
      centre: { lat: 84.9, lng: 0 },
      zoom: 3,
      width: 360,
      height: 640,
    });
    expect(tiles.every((t) => t.y >= 0)).toBe(true);
  });
});

describe('screenPosition', () => {
  it('puts the centre in the centre', () => {
    const at = screenPosition({
      point: YEREVAN,
      centre: YEREVAN,
      zoom: 13,
      width: 360,
      height: 240,
    });
    expect(at.x).toBeCloseTo(180, 6);
    expect(at.y).toBeCloseTo(120, 6);
  });

  it('puts a point north and east up and to the right', () => {
    const at = screenPosition({
      point: { lat: YEREVAN.lat + 0.01, lng: YEREVAN.lng + 0.01 },
      centre: YEREVAN,
      zoom: 13,
      width: 360,
      height: 240,
    });
    // Screen y grows downwards, so further north is a smaller y. Getting this
    // backwards mirrors the whole map about its centre and still looks
    // plausible until you compare it with the street you are standing on.
    expect(at.x).toBeGreaterThan(180);
    expect(at.y).toBeLessThan(120);
  });
});

describe('panBy', () => {
  it('follows the finger', () => {
    // Dragging the surface to the right shows what was to the west, so the
    // centre's longitude decreases.
    const after = panBy({ centre: YEREVAN, zoom: 13, dx: 100, dy: 0 });
    expect(after.lng).toBeLessThan(YEREVAN.lng);

    // Dragging down shows what was to the north.
    const down = panBy({ centre: YEREVAN, zoom: 13, dx: 0, dy: 100 });
    expect(down.lat).toBeGreaterThan(YEREVAN.lat);
  });

  it('moves further per pixel when zoomed out', () => {
    const close = panBy({ centre: YEREVAN, zoom: 15, dx: 100, dy: 0 });
    const far = panBy({ centre: YEREVAN, zoom: 8, dx: 100, dy: 0 });
    expect(YEREVAN.lng - far.lng).toBeGreaterThan(YEREVAN.lng - close.lng);
  });

  it('cannot be dragged past the pole', () => {
    const after = panBy({ centre: { lat: 84, lng: 0 }, zoom: 3, dx: 0, dy: 100_000 });
    expect(Number.isFinite(after.lat)).toBe(true);
    expect(after.lat).toBeLessThanOrEqual(85.1);
  });
});

describe('fitBounds', () => {
  const viewport = { width: 360, height: 240 };

  it('has nothing to say about an empty list', () => {
    expect(fitBounds({ points: [], ...viewport })).toBeNull();
  });

  it('centres on the points it was given', () => {
    const fit = fitBounds({
      points: [
        { lat: 40.1, lng: 44.4 },
        { lat: 40.3, lng: 44.6 },
      ],
      ...viewport,
    })!;
    expect(fit.centre.lat).toBeCloseTo(40.2, 6);
    expect(fit.centre.lng).toBeCloseTo(44.5, 6);
  });

  it('actually fits — every point lands on screen', () => {
    const points = [
      { lat: 40.1776, lng: 44.5126 },
      { lat: 40.2101, lng: 44.4881 },
      { lat: 40.1543, lng: 44.5602 },
    ];
    const fit = fitBounds({ points, ...viewport })!;

    for (const point of points) {
      const at = screenPosition({ point, centre: fit.centre, zoom: fit.zoom, ...viewport });
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x).toBeLessThanOrEqual(viewport.width);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeLessThanOrEqual(viewport.height);
    }
  });

  it('zooms further out for points that are further apart', () => {
    const tight = fitBounds({
      points: [
        { lat: 40.17, lng: 44.51 },
        { lat: 40.18, lng: 44.52 },
      ],
      ...viewport,
    })!;
    const wide = fitBounds({
      points: [
        { lat: 40.0, lng: 44.0 },
        { lat: 41.0, lng: 45.0 },
      ],
      ...viewport,
    })!;
    expect(wide.zoom).toBeLessThan(tight.zoom);
  });

  it('picks a street-level zoom for a single point rather than filling the world', () => {
    const fit = fitBounds({ points: [YEREVAN], ...viewport })!;
    expect(fit.centre).toEqual(YEREVAN);
    expect(fit.zoom).toBeGreaterThanOrEqual(13);
  });
});
