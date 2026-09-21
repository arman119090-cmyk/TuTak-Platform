import {
  fitBounds,
  panBy,
  project,
  screenPosition,
  tileScale,
  tilesForViewport,
  TILE_SIZE,
  unproject,
  worldSize,
  zoomAround,
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

describe('tilesForViewport between levels', () => {
  const viewport = { centre: YEREVAN, width: 360, height: 240, overscan: 0 };

  it('draws a whole level at the natural tile size', () => {
    for (const tile of tilesForViewport({ ...viewport, zoom: 13 })) {
      expect(tile.size).toBe(TILE_SIZE);
      expect(tile.z).toBe(13);
    }
  });

  it('scales the nearest level to a fractional zoom', () => {
    // 13.4 is nearer 13, drawn larger; 13.6 is nearer 14, drawn smaller.
    const below = tilesForViewport({ ...viewport, zoom: 13.4 });
    const above = tilesForViewport({ ...viewport, zoom: 13.6 });
    expect(below[0].z).toBe(13);
    expect(below[0].size).toBeCloseTo(TILE_SIZE * 2 ** 0.4, 6);
    expect(above[0].z).toBe(14);
    expect(above[0].size).toBeCloseTo(TILE_SIZE * 2 ** -0.4, 6);
  });

  it('still covers every corner of the screen mid-pinch', () => {
    for (const zoom of [12.3, 13.5, 13.9, 15.75]) {
      const tiles = tilesForViewport({ ...viewport, zoom });
      for (const [x, y] of [
        [0, 0],
        [viewport.width - 1, 0],
        [0, viewport.height - 1],
        [viewport.width - 1, viewport.height - 1],
      ] as const) {
        const covering = tiles.find(
          (t) => x >= t.left && x < t.left + t.size && y >= t.top && y < t.top + t.size,
        );
        expect(covering).toBeDefined();
      }
    }
  });

  it('keeps the tiles seamless — each one ends where the next begins', () => {
    const tiles = tilesForViewport({ ...viewport, zoom: 13.4 });
    const row = tiles.filter((t) => t.y === tiles[0].y).sort((a, b) => a.left - b.left);
    for (let i = 1; i < row.length; i += 1) {
      expect(row[i].left).toBeCloseTo(row[i - 1].left + row[i - 1].size, 6);
    }
  });

  it('keeps the centre under the centre of the screen at any zoom', () => {
    // The tile that holds the centre must be positioned so that the centre's
    // pixel within it lands exactly at the viewport's middle.
    for (const zoom of [13, 13.4, 13.6]) {
      const { z, scale } = tileScale(zoom);
      const centreWorld = project(YEREVAN, z);
      const tile = tilesForViewport({ ...viewport, zoom }).find(
        (t) =>
          t.x === Math.floor(centreWorld.x / TILE_SIZE) && t.y === Math.floor(centreWorld.y / TILE_SIZE),
      );
      expect(tile).toBeDefined();
      const within = { x: centreWorld.x - tile!.x * TILE_SIZE, y: centreWorld.y - tile!.y * TILE_SIZE };
      expect(tile!.left + within.x * scale).toBeCloseTo(viewport.width / 2, 6);
      expect(tile!.top + within.y * scale).toBeCloseTo(viewport.height / 2, 6);
    }
  });
});

describe('zoomAround', () => {
  const viewport = { width: 360, height: 240 };

  it('zooming about the centre keeps the centre', () => {
    const out = zoomAround({
      ...viewport,
      centre: YEREVAN,
      zoom: 13,
      toZoom: 14,
      focal: { x: 180, y: 120 },
    });
    expect(out.zoom).toBe(14);
    expect(out.centre.lat).toBeCloseTo(YEREVAN.lat, 9);
    expect(out.centre.lng).toBeCloseTo(YEREVAN.lng, 9);
  });

  it('keeps the place under the fingers under the fingers', () => {
    // Whatever was at (300, 40) before the pinch is still at (300, 40) after
    // it. This is the whole reason the function exists.
    const focal = { x: 300, y: 40 };
    const before = { centre: YEREVAN, zoom: 13 };
    const under = unproject(
      {
        x: project(before.centre, before.zoom).x + (focal.x - viewport.width / 2),
        y: project(before.centre, before.zoom).y + (focal.y - viewport.height / 2),
      },
      before.zoom,
    );
    for (const toZoom of [13.5, 14, 15.25, 12]) {
      const after = zoomAround({ ...viewport, ...before, toZoom, focal });
      const at = screenPosition({ ...viewport, point: under, centre: after.centre, zoom: after.zoom });
      expect(at.x).toBeCloseTo(focal.x, 6);
      expect(at.y).toBeCloseTo(focal.y, 6);
    }
  });

  it('stops at the limits instead of drifting past them', () => {
    const focal = { x: 300, y: 40 };
    const pinned = zoomAround({
      ...viewport,
      centre: YEREVAN,
      zoom: 18,
      toZoom: 19.5,
      focal,
      maxZoom: 18,
    });
    expect(pinned.zoom).toBe(18);
    expect(pinned.centre).toEqual(YEREVAN);
    const floor = zoomAround({ ...viewport, centre: YEREVAN, zoom: 5, toZoom: 1, focal, minZoom: 3 });
    expect(floor.zoom).toBe(3);
  });

  it('is undone by zooming back about the same point', () => {
    const focal = { x: 50, y: 200 };
    const there = zoomAround({ ...viewport, centre: YEREVAN, zoom: 13, toZoom: 15.3, focal });
    const back = zoomAround({ ...viewport, ...there, toZoom: 13, focal });
    expect(back.centre.lat).toBeCloseTo(YEREVAN.lat, 9);
    expect(back.centre.lng).toBeCloseTo(YEREVAN.lng, 9);
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
