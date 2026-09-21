import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, LOCALES, negotiateLocale } from './lib/i18n';

const PUBLIC_FILE = /\.(.*)$/;

/**
 * Locale routing.
 *
 * Every storefront URL carries its language (/ru/catalog/sofas), which keeps
 * pages cacheable and gives search engines three real, indexable versions of
 * the catalogue. A bare URL is redirected to the visitor's best match from the
 * Accept-Language header, remembered afterwards in a cookie.
 */
export const proxy = (request: NextRequest): NextResponse => {
  const { pathname, search } = request.nextUrl;

  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/media') ||
    pathname.startsWith('/_next') ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt' ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (first && (LOCALES as readonly string[]).includes(first)) return NextResponse.next();

  const cookieLocale = request.cookies.get('shop_locale')?.value;
  const locale =
    cookieLocale && (LOCALES as readonly string[]).includes(cookieLocale)
      ? cookieLocale
      : negotiateLocale(request.headers.get('accept-language')) || DEFAULT_LOCALE;

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  url.search = search;
  const response = NextResponse.redirect(url);
  response.cookies.set('shop_locale', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 });
  return response;
};

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
