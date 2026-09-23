import type { Metadata } from "next";
import { fmt, getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { paths } from "@/lib/paths";
import { alternates, breadcrumbLd } from "@/lib/seo/jsonld";
import { getFacets, isFiltered, listProducts, parseFilters } from "@/lib/catalog";
import { favoriteIds } from "@/lib/domain/favorites";
import { ProductGrid } from "@/components/product/product-grid";
import { DesktopFilters, MobileFilters, SearchBox, SortSelect } from "@/components/catalog/filters";
import { TrackOnMount } from "@/components/analytics/track-on-mount";
import { JsonLd } from "@/components/ui/json-ld";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const filters = parseFilters(await searchParams);
  return {
    title: m.meta.catalogTitle,
    description: m.meta.catalogDescription,
    // Filter/search/sort combinations are not indexed: they canonicalise to
    // the clean catalog URL, so crawlers never see thousands of variants.
    alternates: alternates(locale, (l) => paths.shop(l)),
    robots: isFiltered(filters) ? { index: false, follow: true } : undefined,
  };
}

export default async function ShopPage({ params, searchParams }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const filters = parseFilters(await searchParams);
  const [products, facets, favorites] = await Promise.all([listProducts(filters, locale), getFacets(locale), favoriteIds()]);

  return (
    <div className="container-lj py-8 md:py-12">
      <JsonLd
        data={breadcrumbLd([
          { name: m.nav.home, path: paths.home(locale) },
          { name: m.catalog.title, path: paths.shop(locale) },
        ])}
      />
      <TrackOnMount
        event="view_item_list"
        params={{ item_list_name: "catalog", items: products.slice(0, 20).map((p) => ({ item_id: p.slug, item_name: p.name, price: p.priceAmd ?? 0 })) }}
      />
      <h1 className="text-h1 font-extrabold">{filters.q ? `“${filters.q}”` : m.catalog.title}</h1>
        <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_1fr] lg:gap-10">
          <DesktopFilters facets={facets} />
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <SearchBox />
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <MobileFilters facets={facets} count={products.length} />
                <SortSelect />
              </div>
            </div>
            <p className="mt-5 mb-6 text-sm text-muted" aria-live="polite" data-testid="result-count">
              {fmt(m.catalog.results, { count: products.length })}
            </p>
            {products.length > 0 ? (
              <ProductGrid products={products} locale={locale} favorites={favorites} priorityCount={2} listName="catalog" columns="wide" />
            ) : (
              <div className="rounded-[var(--radius-card)] bg-mist px-6 py-16 text-center" data-testid="empty-results">
                <p className="text-lg font-semibold">{filters.q ? fmt(m.catalog.searchEmpty, { query: filters.q }) : m.catalog.empty}</p>
                <p className="mt-2 text-ink-2">{m.catalog.emptyHint}</p>
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
