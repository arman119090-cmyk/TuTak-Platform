import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fmt, getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { paths } from "@/lib/paths";
import { alternates, breadcrumbLd } from "@/lib/seo/jsonld";
import { getCollection, listProducts, parseFilters } from "@/lib/catalog";
import { favoriteIds } from "@/lib/domain/favorites";
import { ProductGrid } from "@/components/product/product-grid";
import { JsonLd } from "@/components/ui/json-ld";
import { TrackOnMount } from "@/components/analytics/track-on-mount";

type Props = { params: Promise<{ locale: string; slug: string }> };

async function load(params: Props["params"]) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const collection = await getCollection(slug, locale);
  if (!collection) notFound();
  const products = await listProducts({ ...parseFilters({}), collections: [slug] }, locale);
  // A collection without sellable products is not a page.
  if (products.length === 0) notFound();
  return { locale, collection, products };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, collection } = await load(params);
  const m = getMessages(locale);
  const description = collection.seoDescription ?? collection.description ?? fmt(m.collection.description, { collection: collection.name });
  return {
    title: collection.seoTitle ?? collection.name,
    description,
    alternates: alternates(locale, (l) => paths.collection(l, collection.slug)),
    openGraph: { title: collection.name, description, url: paths.collection(locale, collection.slug) },
  };
}

export default async function CollectionPage({ params }: Props) {
  const { locale, collection, products } = await load(params);
  const m = getMessages(locale);
  const favorites = await favoriteIds();
  return (
    <div>
      <JsonLd
        data={breadcrumbLd([
          { name: m.nav.home, path: paths.home(locale) },
          { name: collection.name, path: paths.collection(locale, collection.slug) },
        ])}
      />
      <TrackOnMount event="view_item_list" params={{ item_list_name: `collection:${collection.slug}`, items: products.map((p) => ({ item_id: p.slug, item_name: p.name, price: p.priceAmd ?? 0 })) }} />
      <header className="accent-transition py-14 md:py-20" style={{ background: `color-mix(in oklab, ${collection.accentColor ?? "#E9E7E1"} 20%, #fbfbf9)` }}>
        <div className="container-lj">
          <p className="eyebrow">{m.nav.collections}</p>
          <h1 className="mt-2 text-display font-extrabold">{collection.name}</h1>
          {collection.description ? <p className="mt-4 max-w-xl text-lg text-ink-2">{collection.description}</p> : null}
        </div>
      </header>
      <div className="container-lj py-10">
        <p className="mb-6 text-sm text-muted">{fmt(m.catalog.results, { count: products.length })}</p>
        <ProductGrid products={products} locale={locale} favorites={favorites} priorityCount={2} listName={`collection:${collection.slug}`} />
      </div>
    </div>
  );
}
