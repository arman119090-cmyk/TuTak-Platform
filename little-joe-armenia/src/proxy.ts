import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, isLocale, negotiateLocale } from "@/i18n/config";

// 1. Locale routing: every storefront URL is /{hy|ru|it|en}/…; anything
//    else is redirected to the saved (cookie) or negotiated locale.
// 2. The visited locale is remembered in a cookie (persistent preference).
// 3. A per-request CSP nonce (Next.js applies it to its own scripts).

const PUBLIC_FILE = /\.[a-z0-9]+$/i;

function csp(nonce: string, dev: boolean): string {
  const analytics = [
    "https://www.googletagmanager.com",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://connect.facebook.net",
    "https://www.facebook.com",
    "https://analytics.tiktok.com",
  ].join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are needed for dynamic accent colours.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' ${analytics}${dev ? " ws:" : ""}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // Idram's hosted page receives a form POST from checkout.
    "form-action 'self' https://banking.idram.am",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const dev = process.env.NODE_ENV !== "production";

  const isAsset =
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/media/") ||
    pathname.startsWith("/uploads/") ||
    PUBLIC_FILE.test(pathname);
  if (isAsset) return NextResponse.next();

  const first = pathname.split("/")[1] ?? "";
  if (first !== "admin" && !isLocale(first)) {
    const saved = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isLocale(saved) ? saved : negotiateLocale(request.headers.get("accept-language"));
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url, 307);
  }

  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce, dev);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);

  if (isLocale(first) && request.cookies.get(LOCALE_COOKIE)?.value !== first) {
    response.cookies.set(LOCALE_COOKIE, first, {
      path: "/",
      maxAge: 365 * 24 * 3600,
      sameSite: "lax",
      secure: !dev,
    });
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|fonts/).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
