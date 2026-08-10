import type { LatLng } from '../../components/map/mercator';

/**
 * Republic Square, Yerevan. The centre of the only city TuTak launches in.
 */
export const DEFAULT_CENTRE: LatLng = { lat: 40.1776, lng: 44.5126 };

export interface ApproximateLocation extends LatLng {
  /** True when this is the city centre rather than where the person is. */
  isFallback: boolean;
}

/**
 * Where to centre the map, today.
 *
 * It returns the city centre, always — and the screen says so, out loud, at
 * the bottom of the list. That is a deliberate step, not an oversight.
 *
 * Reading the device's real position means `expo-location`: a native module
 * with a config plugin, two new manifest permissions, and a runtime prompt.
 * All three are fine; what is not yet fine is *when*. Adding a native
 * dependency means the next APK is the first build to compile it, and this
 * project has lost whole evenings to a build that failed for reasons nothing
 * to do with the feature being tested. The map is worth shipping before that
 * risk is taken, and Yerevan is small enough that its centre is a defensible
 * starting point — 25km covers the city.
 *
 * The seam is here so that turning it on is one file:
 *
 *   1. `pnpm --filter @tutak/mobile add expo-location`
 *   2. add the plugin and the two usage strings to `app.config.js`
 *   3. replace the body below with a permission request and a `getLastKnown`,
 *      keeping `DEFAULT_CENTRE` as the answer for a refusal or a timeout
 *
 * Nothing above this hook changes: it already handles a fallback, already
 * labels it, and the query already re-runs when the centre moves.
 */
export function useApproximateLocation(): ApproximateLocation {
  return { ...DEFAULT_CENTRE, isFallback: true };
}
