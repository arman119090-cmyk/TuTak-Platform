import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from '../../components/map/mercator';

/**
 * Republic Square, Yerevan. The centre of the only city TuTak launches in.
 */
export const DEFAULT_CENTRE: LatLng = { lat: 40.1776, lng: 44.5126 };

/** Where a position came from — the city centre, the OS's cache, or a fix taken now. */
export type LocationSource = 'city' | 'cached' | 'fresh';

export interface ApproximateLocation extends LatLng {
  /** True when this is the city centre rather than where the person is. */
  isFallback: boolean;
  source: LocationSource;
  /** When the position was taken, per the OS; null for the city centre. */
  fixedAt: number | null;
  /**
   * True while the map is on a cached position and a fresh fix has been
   * asked for and not arrived (timed out, or still on its way). The screen
   * says so rather than presenting the cache as "you are here".
   */
  isStale: boolean;
  /** Ask for a fresh fix now — the recentre button. A no-op without permission. */
  refresh: () => void;
}

/** How long to wait for a fresh fix before settling for what we have. */
const FIX_TIMEOUT_MS = 8000;

/**
 * Bounds on the cached position (audit 21.09.2026, D16). A last-known fix
 * from yesterday, or one accurate to a kilometre, is not "near you" for a
 * list sorted by distance; the OS is asked only for a cache younger and
 * tighter than this, and anything older is treated as no cache at all.
 */
export const LAST_KNOWN_MAX_AGE_MS = 5 * 60_000;
export const LAST_KNOWN_REQUIRED_ACCURACY_M = 500;

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
 * Four deliberate choices:
 *
 * 1. **A refusal is not an error.** Someone who declines the prompt gets the
 *    city centre and the note that says so, exactly as before — no retry
 *    loop, no second prompt, no screen that refuses to work. Location is how
 *    this screen sorts a list, not something it needs to function.
 *
 * 2. **The last known position first, then a fresh fix.** A cold GPS fix
 *    outdoors can take ten seconds or more; a cached one from the last few
 *    minutes is usually within a few hundred metres and arrives immediately.
 *    The fresh fix replaces it when it lands.
 *
 * 3. **The fresh fix is raced against a timeout.** `getCurrentPositionAsync`
 *    can wait indefinitely indoors. The screen is already usable by then, so
 *    a fix that never arrives must not leave anything hanging on it — but
 *    the cache it leaves behind is then *marked* stale, not passed off as
 *    current.
 *
 * 4. **Recentre means a new fix.** `refresh` asks the OS again; it does not
 *    re-prompt for permission and it does not re-centre on the cache.
 */
export function useApproximateLocation(): ApproximateLocation {
  const [location, setLocation] = useState<Omit<ApproximateLocation, 'refresh'>>({
    ...DEFAULT_CENTRE,
    isFallback: true,
    source: 'city',
    fixedAt: null,
    isStale: false,
  });
  // The component can unmount while a fix is still in flight — a person who
  // opens the map and immediately leaves it should not produce a state
  // update on a screen that is gone.
  const live = useRef(true);
  const granted = useRef(false);

  const apply = useCallback(
    (position: { coords: { latitude: number; longitude: number }; timestamp?: number }, source: 'cached' | 'fresh') => {
      if (!live.current) return;
      setLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        isFallback: false,
        source,
        fixedAt: typeof position.timestamp === 'number' ? position.timestamp : Date.now(),
        isStale: false,
      });
    },
    [],
  );

  /** One attempt at a fresh fix; on timeout, whatever is showing is marked stale. */
  const fetchFresh = useCallback(async () => {
    try {
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
      ]);
      if (!live.current) return;
      if (fresh) {
        apply(fresh, 'fresh');
      } else {
        setLocation((current) => (current.source === 'cached' ? { ...current, isStale: true } : current));
      }
    } catch {
      if (!live.current) return;
      setLocation((current) => (current.source === 'cached' ? { ...current, isStale: true } : current));
    }
  }, [apply]);

  const refresh = useCallback(() => {
    if (!granted.current) return;
    void fetchFresh();
  }, [fetchFresh]);

  useEffect(() => {
    live.current = true;

    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        // Declined: keep the city centre, and keep the note that says so.
        if (!permission.granted || !live.current) return;
        granted.current = true;

        const last = await Location.getLastKnownPositionAsync({
          maxAge: LAST_KNOWN_MAX_AGE_MS,
          requiredAccuracy: LAST_KNOWN_REQUIRED_ACCURACY_M,
        });
        if (last) apply(last, 'cached');
        if (!live.current) return;

        await fetchFresh();
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
  }, [apply, fetchFresh]);

  return { ...location, refresh };
}
