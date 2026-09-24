import { NextResponse, type NextRequest } from 'next/server';
import { i18nConfig, isLocale } from '@/i18n/config';
import { negotiateLocale } from '@/i18n/negotiate';

/**
 * Locale routing. A path that already starts with a locale passes through;
 * anything else is redirected to the negotiated locale (remembered choice →
 * browser language → English). Rules live in src/i18n/config.ts.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split('/')[1];
  if (isLocale(first)) return NextResponse.next();

  const locale = negotiateLocale({
    cookie: request.cookies.get(i18nConfig.cookieName)?.value,
    acceptLanguage: request.headers.get('accept-language'),
  });
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  url.search = search;
  const res = NextResponse.redirect(url, 307);
  res.headers.set('Vary', 'Accept-Language, Cookie');
  return res;
}

export const config = {
  // Everything except Next internals, the API and files with an extension.
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
};
