import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from '../../components/map/mercator';

/**
 * Republic Square, Yerevan. The centre of the only city TuTak launches in.
 */
export const DEFAULT_CENTRE: LatLng = { lat: 40.1776, lng: 44.5126 };

export interface ApproximateLocation extends LatLng {
  /** True when this is the city centre rather than where the person is. */
  isFallback: boolean;
}

/** How long to wait for a fresh fix before settling for what we have. */
const FIX_TIMEOUT_MS = 8000;

/**
 * Where to centre the map.
 *
 * This used to return the city centre unconditionally, with the screen
 * saying so out loud. That was a deliberate placeholder — the seam its own
 * comment described — and this is the file it promised: the permission
 * request, a real fix, and `DEFAULT_CENTRE` kept as the answer for a refusal
 * or a timeout. Nothing above this hook changes, because the screen already
 * handles a moving centre: every query is keyed on the coordinates, and the
 * "showing the city centre" note is already conditional on `isFallback`.
 *
 * Three deliberate choices:
 *
 * 1. **A refusal is not an error.** Someone who declines the prompt gets the
 *    city centre and the note that says so, exactly as before — no retry
 *    loop, no second prompt, no screen that refuses to work. Location is how
 *    this screen sorts a list, not something it needs to function.
 *
 * 2. **The last known position first, then a fresh fix.** A cold GPS fix
 *    outdoors can take ten seconds or more; the cached one is usually within
 *    a few hundred metres and arrives immediately, which for "partners near
 *    me, 25km" is indistinguishable from exact. The fresh fix replaces it
 *    when it lands.
 *
 * 3. **The fresh fix is raced against a timeout.** `getCurrentPositionAsync`
 *    can wait indefinitely indoors. The screen is already usable by then, so
 *    a fix that never arrives must not leave anything hanging on it.
 */
export function useApproximateLocation(): ApproximateLocation {
  const [location, setLocation] = useState<ApproximateLocation>({
    ...DEFAULT_CENTRE,
    isFallback: true,
  });
  // The component can unmount while a fix is still in flight — a person who
  // opens the map and immediately leaves it should not produce a state
  // update on a screen that is gone.
  const live = useRef(true);

  useEffect(() => {
    live.current = true;

    const apply = (coords: { latitude: number; longitude: number }) => {
      if (!live.current) return;
      setLocation({ lat: coords.latitude, lng: coords.longitude, isFallback: false });
    };

    void (async () => {
      try {
        const { granted } = await Location.requestForegroundPermissionsAsync();
        // Declined: keep the city centre, and keep the note that says so.
        if (!granted || !live.current) return;

        const last = await Location.getLastKnownPositionAsync();
        if (last) apply(last.coords);
        if (!live.current) return;

        const fresh = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
        ]);
        if (fresh) apply(fresh.coords);
      } catch {
        // A device with location services switched off, an emulator with no
        // provider, a web browser that blocks it: all end up here, and all
        // mean the same thing to this screen — show the city centre and say
        // so. Deliberately silent: it is not a failure worth a log line on
        // every launch.
      }
    })();

    return () => {
      live.current = false;
    };
  }, []);

  return location;
}
