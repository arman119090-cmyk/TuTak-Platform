import { NextResponse } from 'next/server';
import { searchSuggest } from '@/lib/catalog/queries';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const GET = async (request: Request): Promise<Response> => {
  const limit = rateLimit(clientKey(request, 'suggest'), 60, 60);
  if (!limit.allowed) {
    return NextResponse.json({ products: [], categories: [] }, { status: 429 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').slice(0, 80);
  const localeParam = url.searchParams.get('locale');
  const locale = isLocale(localeParam) ? localeParam : DEFAULT_LOCALE;

  if (query.trim().length < 2) return NextResponse.json({ products: [], categories: [] });
  return NextResponse.json(await searchSuggest(query, locale));
};
