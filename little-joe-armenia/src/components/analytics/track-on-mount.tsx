"use client";

import { useEffect, useRef } from "react";
import { track, type AnalyticsEvent, type AnalyticsParams } from "@/components/analytics/track";

/**
 * Fires one analytics event when mounted. `onceKey` guards against double
 * firing across remounts/reloads (used for `purchase`, together with the
 * server-side Order.purchaseTrackedAt flag).
 */
export function TrackOnMount({ event, params, onceKey }: { event: AnalyticsEvent; params: AnalyticsParams; onceKey?: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (onceKey) {
      try {
        if (localStorage.getItem(onceKey)) return;
        localStorage.setItem(onceKey, "1");
      } catch {
        /* ignore */
      }
    }
    // Consent is resolved in Analytics' effect, which runs in the same tick.
    setTimeout(() => track(event, params), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
