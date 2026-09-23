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
import Image from "next/image";
import { lineMeta } from "@/lib/lines";

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
  const meta = lineMeta(collection.slug, locale);
  const accent = collection.accentColor ?? meta?.accent ?? "#1E88E5";
  return (
    <div>
      <JsonLd
        data={breadcrumbLd([
          { name: m.nav.home, path: paths.home(locale) },
          { name: collection.name, path: paths.collection(locale, collection.slug) },
        ])}
      />
      <TrackOnMount event="view_item_list" params={{ item_list_name: `collection:${collection.slug}`, items: products.map((p) => ({ item_id: p.slug, item_name: p.name, price: p.priceAmd ?? 0 })) }} />
      {/* Line banner: the line's colour and its brand-book art (mascot + pack). */}
      <header className="relative overflow-hidden" style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${accent} 22%, white) 0%, #ffffff 100%)` }}>
        <div className="container-lj grid grid-cols-[minmax(0,1fr)] items-center gap-6 pt-10 md:grid-cols-[1.2fr_1fr] md:pt-12">
          <div className="pb-4 md:pb-14">
            <p className="display text-[0.75rem] uppercase tracking-[0.08em] text-brand">{m.nav.collections}</p>
            <h1 className="display mt-3 text-[clamp(2.3rem,1.5rem+3.4vw,4.4rem)] leading-[0.98]">{collection.name}</h1>
            {meta?.tagline ? <p className="hand mt-3 -rotate-1 text-[clamp(1.5rem,1.2rem+1vw,2.1rem)] leading-tight">{meta.tagline}</p> : null}
            {collection.description ? <p className="mt-4 max-w-xl text-[1.05rem] leading-relaxed text-ink-2">{collection.description}</p> : null}
          </div>
          {meta?.hero ? (
            <Image
              src={meta.hero.url}
              alt=""
              width={meta.hero.width}
              height={meta.hero.height}
              priority
              sizes="(min-width: 768px) 38vw, 90vw"
              className="mx-auto h-auto max-h-[26rem] w-auto self-end mix-blend-multiply md:max-h-[30rem]"
            />
          ) : null}
        </div>
      </header>
      <div className="container-lj py-10">
        <p className="mb-6 text-sm text-muted">{fmt(m.catalog.results, { count: products.length })}</p>
        <ProductGrid products={products} locale={locale} favorites={favorites} priorityCount={2} listName={`collection:${collection.slug}`} />
      </div>
    </div>
  );
}
