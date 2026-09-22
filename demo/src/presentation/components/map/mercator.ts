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
  /**
   * The side to draw the tile at, in screen pixels.
   *
   * `TILE_SIZE` exactly at a whole zoom level. Between levels — mid-pinch,
   * where the zoom is 13.4 — the nearest level's tiles are drawn scaled by
   * `2^(zoom − z)`, so the map grows smoothly under the fingers instead of
   * snapping a level at a time. Between √½ and √2 of their natural size,
   * which is the range that stays sharp enough to read.
   */
  size: number;
}

/**
 * The tile level to draw a zoom with, and the factor to scale its tiles by.
 *
 * Every provider only has whole levels. A fractional zoom is drawn from the
 * nearest one, scaled — so `13.4` is level 13 at ×1.32, and `13.6` is level
 * 14 at ×0.76.
 */
export function tileScale(zoom: number): { z: number; scale: number } {
  const z = Math.round(zoom);
  return { z, scale: 2 ** (zoom - z) };
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
  const { z, scale } = tileScale(zoom);
  const span = 2 ** z;
  // Each tile's footprint on screen. At a whole level this is `TILE_SIZE`;
  // mid-pinch it is the level's tiles stretched or shrunk to the zoom asked.
  const size = TILE_SIZE * scale;

  // Measured at the zoom actually asked for, not at the level drawn from,
  // so the centre stays put while the tiles around it scale.
  const centreWorld = project(centre, zoom);
  // The world pixel that lands on the viewport's top-left corner.
  const originX = centreWorld.x - width / 2;
  const originY = centreWorld.y - height / 2;

  const firstCol = Math.floor(originX / size) - overscan;
  const lastCol = Math.floor((originX + width) / size) + overscan;
  const firstRow = Math.floor(originY / size) - overscan;
  const lastRow = Math.floor((originY + height) / size) + overscan;

  const tiles: Tile[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    if (row < 0 || row >= span) continue;
    for (let col = firstCol; col <= lastCol; col += 1) {
      tiles.push({
        x: ((col % span) + span) % span,
        y: row,
        z,
        left: col * size - originX,
        top: row * size - originY,
        size,
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
  // The projection takes a fractional zoom as it is: markers have to sit on
  // the tiles at every instant of a pinch, not only at the levels the tiles
  // come in.
  const target = project(params.point, params.zoom);
  const centre = project(params.centre, params.zoom);

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
  const { zoom } = params;
  const world = project(params.centre, zoom);
  const size = worldSize(zoom);

  return unproject(
    {
      x: world.x - params.dx,
      // Clamped so a hard upward drag cannot flip past the pole into a blank
      // world. Longitude is left to wrap; latitude has an end.
      y: clamp(world.y - params.dy, 0, size),
    },
    zoom,
  );
}

/**
 * The centre after zooming about a point on screen.
 *
 * What a pinch and a double-tap both need: the place under the fingers has
 * to stay under the fingers. Zooming about the viewport's centre instead
 * makes the street a person is pinching towards slide off the side — the
 * map zooms, but not onto what they meant.
 *
 * `focal` is in pixels from the viewport's top-left, like `screenPosition`
 * returns. The zoom is clamped to `[minZoom, maxZoom]` here, so a pinch past
 * the last level stops rather than drifting the centre by a clamped amount
 * nobody asked for.
 */
export function zoomAround(params: {
  centre: LatLng;
  zoom: number;
  toZoom: number;
  focal: WorldPoint;
  width: number;
  height: number;
  minZoom?: number;
  maxZoom?: number;
}): { centre: LatLng; zoom: number } {
  const { centre, zoom, focal, width, height } = params;
  const toZoom = clamp(params.toZoom, params.minZoom ?? 0, params.maxZoom ?? 22);
  if (toZoom === zoom) return { centre, zoom };

  // The world pixel under the focal point, at the zoom being left.
  const offsetX = focal.x - width / 2;
  const offsetY = focal.y - height / 2;
  const before = project(centre, zoom);
  const anchor = unproject({ x: before.x + offsetX, y: before.y + offsetY }, zoom);

  // The same place, at the zoom being entered, must land on the same pixel.
  const after = project(anchor, toZoom);
  const size = worldSize(toZoom);
  return {
    centre: unproject({ x: after.x - offsetX, y: clamp(after.y - offsetY, 0, size) }, toZoom),
    zoom: toZoom,
  };
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
