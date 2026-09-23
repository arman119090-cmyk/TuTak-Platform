"use client";

import Script from "next/script";
import { useEffect } from "react";
import { useI18n } from "@/i18n/provider";
import { useLocal, writeLocal } from "@/lib/local-store";

// Loads GA4 / Meta Pixel / TikTok Pixel only after explicit consent.
// IDs come from admin settings; when none is configured, nothing loads and
// no banner is shown.

const KEY = "lj_consent";

export function Analytics({
  nonce,
  ga4Id,
  metaPixelId,
  tiktokPixelId,
}: {
  nonce?: string;
  ga4Id?: string;
  metaPixelId?: string;
  tiktokPixelId?: string;
}) {
  const { m } = useI18n();
  const configured = Boolean(ga4Id || metaPixelId || tiktokPixelId);
  const raw = useLocal(KEY);
  // undefined = not hydrated yet (render nothing), null = not decided.
  const consent: "granted" | "denied" | null | undefined = raw === undefined ? undefined : raw === "granted" || raw === "denied" ? raw : null;

  useEffect(() => {
    // Development/test helper: events are still recorded locally without tags.
    (window as Window & { __ljConsent?: boolean }).__ljConsent =
      consent === "granted" || (!configured && process.env.NODE_ENV !== "production");
  }, [consent, configured]);

  const decide = (v: "granted" | "denied") => writeLocal(KEY, v);

  if (!configured) return null;

  return (
    <>
      {consent === null ? (
        <div
          role="region"
          aria-label={m.consent.text}
          className="fixed inset-x-3 bottom-[calc(4.25rem+var(--safe-bottom))] z-50 md:bottom-4 mx-auto flex max-w-xl flex-col gap-3 rounded-3xl bg-card p-4 shadow-[var(--shadow-float)] ring-1 ring-line sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-sm text-ink-2">{m.consent.text}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost min-h-11 flex-1 px-4" onClick={() => decide("denied")}>
              {m.consent.decline}
            </button>
            <button type="button" className="btn btn-primary min-h-11 flex-1 px-4" onClick={() => decide("granted")}>
              {m.consent.accept}
            </button>
          </div>
        </div>
      ) : null}
      {consent === "granted" && ga4Id ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`} strategy="afterInteractive" nonce={nonce} />
          <Script id="ga4" strategy="afterInteractive" nonce={nonce}>
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config',${JSON.stringify(ga4Id)},{send_page_view:true});`}
          </Script>
        </>
      ) : null}
      {consent === "granted" && metaPixelId ? (
        <Script id="meta-pixel" strategy="afterInteractive" nonce={nonce}>
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(metaPixelId)});fbq('track','PageView');`}
        </Script>
      ) : null}
      {consent === "granted" && tiktokPixelId ? (
        <Script id="tiktok-pixel" strategy="afterInteractive" nonce={nonce}>
          {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";var s=d.createElement("script");s.async=!0;s.src=n+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(s,a)};ttq.load(${JSON.stringify(tiktokPixelId)});ttq.page();}(window,document,'ttq');`}
        </Script>
      ) : null}
    </>
  );
}
