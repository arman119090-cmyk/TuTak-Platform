import { NextResponse } from 'next/server';
import { queryCatalog } from '@/lib/catalog/queries';
import { parseCatalogSearchParams } from '@/lib/catalog/params';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n';

/** Used by "load more" in the catalogue; the first page is server-rendered. */
export const GET = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const localeParam = url.searchParams.get('locale');
  const locale = isLocale(localeParam) ? localeParam : DEFAULT_LOCALE;
  const query = parseCatalogSearchParams(url.searchParams, locale);
  const result = await queryCatalog(query);
  return NextResponse.json({
    items: result.items,
    total: result.total,
    page: result.page,
    pageCount: result.pageCount,
  });
};
