import { NextResponse } from 'next/server';
import { getProductCardsByIds } from '@/lib/catalog/queries';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n';

export const GET = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 24);
  const localeParam = url.searchParams.get('locale');
  const locale = isLocale(localeParam) ? localeParam : DEFAULT_LOCALE;

  return NextResponse.json({ items: await getProductCardsByIds(ids, locale) });
};
