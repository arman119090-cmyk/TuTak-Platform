import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { artworkUrl } from '@/lib/media/artwork';
import type { Dictionary, Locale } from '@/lib/i18n';
import { queryCatalog, type CategoryTree } from '@/lib/catalog/queries';
import { parseCatalogSearchParams } from '@/lib/catalog/params';
import { Breadcrumbs, EmptyState, LinkButton } from '@/components/ui';

/** Subcategory tiles get their own tone so a row of them never looks cloned. */
const TILE_TONES = ['beige', 'emerald', 'graphite', 'oak', 'navy', 'terracotta', 'olive', 'walnut'];
const toneFor = (slug: string): string =>
  TILE_TONES[[...slug].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TILE_TONES.length]!;
import { CatalogToolbar } from './catalog-toolbar';
import { CatalogGrid } from './catalog-grid';
import { FiltersPanel } from './filters-panel';
import { Pagination } from './pagination';
import { breadcrumbJsonLd, JsonLd } from '@/lib/seo';

export type CatalogPageProps = {
  locale: Locale;
  dict: Dictionary;
  searchParams: Record<string, string | string[] | undefined>;
  category?: {
    slug: string;
    name: string;
    description: string;
    artKey: string;
    parent: { slug: string; name: string } | null;
    children: { slug: string; name: string; artKey: string; productCount: number }[];
  } | null;
  tree?: CategoryTree;
  title?: string;
};

const toSearchParams = (input: Record<string, string | string[] | undefined>): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value) && value[0]) params.set(key, value.join(','));
  }
  return params;
};

/** Shared rendering for /catalog and /catalog/[slug]. */
export const CatalogPageView = async ({
  locale,
  dict,
  searchParams,
  category,
  tree,
  title,
}: CatalogPageProps) => {
  const params = toSearchParams(searchParams);
  const query = parseCatalogSearchParams(params, locale, category?.slug);
  const result = await queryCatalog(query);

  const basePath = category ? `/${locale}/catalog/${category.slug}` : `/${locale}/catalog`;
  const heading = title ?? category?.name ?? dict.catalog.title;

  const crumbs = [
    { label: dict.common.home, href: `/${locale}` },
    { label: dict.nav.catalog, href: `/${locale}/catalog` },
    ...(category?.parent
      ? [{ label: category.parent.name, href: `/${locale}/catalog/${category.parent.slug}` }]
      : []),
    ...(category ? [{ label: category.name, href: basePath }] : []),
  ];

  const subcategories =
    category?.children ??
    tree?.map((root) => ({
      slug: root.slug,
      name: root.name,
      artKey: root.artKey,
      productCount: root.productCount,
    })) ??
    [];

  return (
    <div className="container-page py-6 md:py-8">
      <JsonLd
        data={breadcrumbJsonLd(
          crumbs.map((crumb) => ({ name: crumb.label, url: crumb.href ?? '/' })),
        )}
      />
      <Breadcrumbs items={crumbs} />

      <header className="mb-6">
        <h1 className="text-[30px] md:text-[40px]">{heading}</h1>
        {category?.description ? (
          <p className="mt-2 max-w-3xl text-sm text-muted md:text-[15px]">{category.description}</p>
        ) : null}
      </header>

      {subcategories.length > 0 ? (
        <div className="hide-scrollbar mb-8 -mx-4 flex gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-4 md:px-0 lg:grid-cols-6">
          {subcategories.map((child) => (
            <Link
              key={child.slug}
              href={`/${locale}/catalog/${child.slug}`}
              className="card-hover group w-40 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface md:w-auto"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artworkUrl(child.artKey, toneFor(child.slug), 0, child.slug.length + 5)}
                alt=""
                className="aspect-[4/3] w-full bg-surface-2 object-cover"
                loading="lazy"
              />
              <div className="px-3 py-2.5">
                <p className="text-[13px] leading-tight group-hover:text-accent">{child.name}</p>
                <p className="mt-0.5 text-[11px] text-muted tabular-nums">{child.productCount}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[264px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-[168px]">
            <h2 className="mb-1 text-[15px] font-sans font-semibold">{dict.catalog.filters}</h2>
            <FiltersPanel facets={result.facets} basePath={basePath} dict={dict} />
          </div>
        </aside>

        <div>
          <CatalogToolbar
            total={result.total}
            basePath={basePath}
            facets={result.facets}
            dict={dict}
          />

          {result.items.length === 0 ? (
            <EmptyState
              icon={<PackageSearch width={40} height={40} strokeWidth={1.4} />}
              title={dict.catalog.emptyTitle}
              text={dict.catalog.emptyText}
              action={
                <LinkButton href={basePath} variant="secondary">
                  {dict.catalog.resetFilters}
                </LinkButton>
              }
            />
          ) : (
            <>
              <CatalogGrid products={result.items} locale={locale} dict={dict} />
              <Pagination
                page={result.page}
                pageCount={result.pageCount}
                basePath={basePath}
                dict={dict}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};
