/** Mean radius of the Earth, in kilometres. */
const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Straight-line distance between two points on the globe, in kilometres.
 *
 * Haversine rather than the flat-earth approximation a bounding-box "nearby"
 * query uses to narrow the database scan. The box makes the database do less
 * work; this decides what the customer is actually told, and "1.4 km" being
 * wrong by a few hundred metres because the maths assumed a plane is the kind
 * of thing somebody notices when they walk it.
 *
 * Rounded to one decimal because that is the precision a person can act on.
 * Two would be false confidence: the pin is one someone dropped on a
 * building, not a doorway.
 *
 * Shared by every module that has a "nearby" endpoint (partners, EV
 * stations) rather than duplicated per module — the two callers' "nearby"
 * meant the same maths from day one.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  return Math.round(EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}
