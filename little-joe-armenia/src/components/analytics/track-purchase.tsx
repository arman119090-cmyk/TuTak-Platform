"use client";

import { useEffect, useRef } from "react";
import { claimPurchaseEventAction } from "@/app/actions/analytics";
import { track, type AnalyticsParams } from "@/components/analytics/track";

/** Fires `purchase` at most once per order, and only with analytics consent. */
export function TrackPurchase({ number, token, params }: { number: string; token: string; params: AnalyticsParams }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // Consent flag is set by <Analytics/>; wait one tick for it.
    const id = setTimeout(async () => {
      if (!(window as Window & { __ljConsent?: boolean }).__ljConsent) return;
      try {
        if (await claimPurchaseEventAction(number, token)) track("purchase", params);
      } catch {
        /* analytics must never break the page */
      }
    }, 0);
    return () => clearTimeout(id);
  }, [number, token, params]);
  return null;
}
