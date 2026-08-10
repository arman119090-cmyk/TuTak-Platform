/**
 * Web Mercator, which is the only thing a tile map actually is.
 *
 * Every raster tile service — OpenStreetMap, Google, Carto, Mapbox — cuts the
 * world into 256px squares under the same projection and addresses them as
 * `{z}/{x}/{y}`. Given that, drawing a map is: project the centre to a pixel,
 * work out which squares cover the screen, and place them. There is no part of
 * that which needs a native module or an API key, which is why this file
 * exists rather than a dependency.
 *
 * Everything here is pure and framework-free so it can be tested without
 * rendering anything. The component beside it does nothing but position what
 * these functions return.
 */

/** Tiles are 256×256 by convention, and every provider follows it. */
export const TILE_SIZE = 256;

/**
 * The latitude at which the projection is cut off.
 *
 * Mercator sends the poles to infinity, so every implementation truncates. The
 * standard cut is ~85.05113°, which is exactly the latitude that makes the
 * projected world square — that squareness is what lets a tile at zoom z be
 * addressed by two integers in `[0, 2^z)`.
 */
export const MAX_LATITUDE = 85.05112877980659;

export interface LatLng {
  lat: number;
  lng: number;
}

/** A point in the projected world, in pixels, at a given zoom. */
export interface WorldPoint {
  x: number;
  y: number;
}

/** The side of the whole projected world, in pixels. */
export const worldSize = (zoom: number): number => TILE_SIZE * 2 ** zoom;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Degrees to world pixels.
 *
 * Longitude is linear. Latitude is not — that is the whole point of Mercator,
 * and it is why a marker cannot be placed by interpolating between two corners
 * of the screen. Getting this wrong puts every pin a few streets north of
 * where it belongs, more so the further from the equator, which is the kind of
 * error that looks like "the map is a bit off" rather than like a bug.
 */
export function project(point: LatLng, zoom: number): WorldPoint {
  const size = worldSize(zoom);
  const lat = clamp(point.lat, -MAX_LATITUDE, MAX_LATITUDE);
  const sin = Math.sin((lat * Math.PI) / 180);

  return {
    x: ((point.lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** World pixels back to degrees. The inverse of `project`, exactly. */
export function unproject(point: WorldPoint, zoom: number): LatLng {
  const size = worldSize(zoom);
  const n = Math.PI - 2 * Math.PI * (point.y / size);

  return {
    lng: (point.x / size) * 360 - 180,
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
  };
}

export interface Tile {
  x: number;
  y: number;
  z: number;
  /** Where the tile's top-left corner sits, in screen pixels. */
  left: number;
  top: number;
}

/**
 * The tiles needed to cover a viewport, and where to put each one.
 *
 * `overscan` fetches a ring of tiles beyond the edges so a drag reveals map
 * rather than background. One ring is the right number: it costs four extra
 * requests on a phone-sized screen and covers a fast flick, and two would
 * double the traffic for a case the user has to work at to reach.
 *
 * Columns wrap around the antimeridian — tile x is taken modulo the world —
 * because a map centred near ±180° otherwise shows a hard edge. Rows are not
 * wrapped: above the top row there is no more world, and a tile requested
 * there is a 404 from every provider.
 */
export function tilesForViewport(params: {
  centre: LatLng;
  zoom: number;
  width: number;
  height: number;
  overscan?: number;
}): Tile[] {
  const { centre, zoom, width, height } = params;
  const overscan = params.overscan ?? 1;
  const z = Math.round(zoom);
  const span = 2 ** z;

  const centreWorld = project(centre, z);
  // The world pixel that lands on the viewport's top-left corner.
  const originX = centreWorld.x - width / 2;
  const originY = centreWorld.y - height / 2;

  const firstCol = Math.floor(originX / TILE_SIZE) - overscan;
  const lastCol = Math.floor((originX + width) / TILE_SIZE) + overscan;
  const firstRow = Math.floor(originY / TILE_SIZE) - overscan;
  const lastRow = Math.floor((originY + height) / TILE_SIZE) + overscan;

  const tiles: Tile[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    if (row < 0 || row >= span) continue;
    for (let col = firstCol; col <= lastCol; col += 1) {
      tiles.push({
        x: ((col % span) + span) % span,
        y: row,
        z,
        left: col * TILE_SIZE - originX,
        top: row * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}

/**
 * Where a coordinate lands on screen, given what the viewport is showing.
 *
 * Used for every marker. Returns pixels from the viewport's top-left, which
 * may be negative or past the far edge — the caller decides whether to draw
 * something that is off screen, because a marker layer that culls at exactly
 * the boundary makes pins pop in and out at the edges as you drag.
 */
export function screenPosition(params: {
  point: LatLng;
  centre: LatLng;
  zoom: number;
  width: number;
  height: number;
}): WorldPoint {
  const z = Math.round(params.zoom);
  const target = project(params.point, z);
  const centre = project(params.centre, z);

  return {
    x: target.x - centre.x + params.width / 2,
    y: target.y - centre.y + params.height / 2,
  };
}

/**
 * The centre after dragging the map by a number of screen pixels.
 *
 * Inverted on purpose: dragging the surface right moves the viewport left, and
 * a map that moves the other way from the finger is immediately, physically
 * wrong in a way people notice before they can say why.
 */
export function panBy(params: {
  centre: LatLng;
  zoom: number;
  dx: number;
  dy: number;
}): LatLng {
  const z = Math.round(params.zoom);
  const world = project(params.centre, z);
  const size = worldSize(z);

  return unproject(
    {
      x: world.x - params.dx,
      // Clamped so a hard upward drag cannot flip past the pole into a blank
      // world. Longitude is left to wrap; latitude has an end.
      y: clamp(world.y - params.dy, 0, size),
    },
    z,
  );
}

/**
 * A zoom that covers every point, plus the centre it should use.
 *
 * The alternative — open at a fixed zoom on the user's location — shows an
 * empty map wherever the nearest partner is a kilometre away, and "there is
 * nothing here" is the wrong first impression when there are eleven of them
 * just off screen.
 *
 * `padding` is a fraction of the viewport kept clear at the edges, so a pin
 * never sits underneath the search field or half off the side.
 */
export function fitBounds(params: {
  points: LatLng[];
  width: number;
  height: number;
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}): { centre: LatLng; zoom: number } | null {
  const { points, width, height } = params;
  if (points.length === 0 || width <= 0 || height <= 0) return null;

  const padding = params.padding ?? 0.15;
  const minZoom = params.minZoom ?? 3;
  const maxZoom = params.maxZoom ?? 17;

  const lats = points.map((p) => clamp(p.lat, -MAX_LATITUDE, MAX_LATITUDE));
  const lngs = points.map((p) => p.lng);
  const centre: LatLng = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };

  // A single point has no extent to fit, so there is nothing to solve for.
  if (points.length === 1) return { centre, zoom: Math.min(15, maxZoom) };

  const usableWidth = width * (1 - padding * 2);
  const usableHeight = height * (1 - padding * 2);

  // Measured at zoom 0 and scaled: the projection doubles with each level, so
  // the largest zoom whose span still fits is found by one logarithm rather
  // than by trying each level.
  const topLeft = project({ lat: Math.max(...lats), lng: Math.min(...lngs) }, 0);
  const bottomRight = project({ lat: Math.min(...lats), lng: Math.max(...lngs) }, 0);
  const spanX = Math.max(bottomRight.x - topLeft.x, 1e-6);
  const spanY = Math.max(bottomRight.y - topLeft.y, 1e-6);

  const zoom = Math.floor(
    Math.min(Math.log2(usableWidth / spanX), Math.log2(usableHeight / spanY)),
  );

  return { centre, zoom: clamp(zoom, minZoom, maxZoom) };
}
