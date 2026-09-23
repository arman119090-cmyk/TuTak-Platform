import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = env().APP_URL;
  // A demo deployment must not be indexed at all.
  if (env().DEMO_MODE) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/", "/*/cart", "/*/checkout", "/*/account", "/*/order/", "/*/pay/", "/*/favorites", "/*/compare"],
        // Filtered catalog URLs stay crawlable on purpose: they carry
        // noindex + canonical, which crawlers can only see if allowed in.
      },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
    host: base,
  };
}
