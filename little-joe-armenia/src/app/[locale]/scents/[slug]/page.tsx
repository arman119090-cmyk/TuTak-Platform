import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fmt, getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { paths } from "@/lib/paths";
import { alternates, breadcrumbLd } from "@/lib/seo/jsonld";
import { getFamily, listProducts, parseFilters } from "@/lib/catalog";
import { favoriteIds } from "@/lib/domain/favorites";
import { ProductGrid } from "@/components/product/product-grid";
import { JsonLd } from "@/components/ui/json-ld";

type Props = { params: Promise<{ locale: string; slug: string }> };

async function load(params: Props["params"]) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const family = await getFamily(slug, locale);
  if (!family) notFound();
  const products = await listProducts({ ...parseFilters({}), families: [slug] }, locale);
  if (products.length === 0) notFound();
  return { locale, family, products };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, family } = await load(params);
  const m = getMessages(locale);
  const title = fmt(m.scents.title, { family: family.name });
  const description = family.description ?? fmt(m.scents.description, { family: family.name });
  return {
    title,
    description,
    alternates: alternates(locale, (l) => paths.family(l, family.slug)),
    openGraph: { title, description, url: paths.family(locale, family.slug) },
  };
}

export default async function FamilyPage({ params }: Props) {
  const { locale, family, products } = await load(params);
  const m = getMessages(locale);
  const favorites = await favoriteIds();
  return (
    <div>
      <JsonLd
        data={breadcrumbLd([
          { name: m.nav.home, path: paths.home(locale) },
          { name: family.name, path: paths.family(locale, family.slug) },
        ])}
      />
      <header className="py-14 md:py-20" style={{ background: `color-mix(in oklab, ${family.accentColor ?? "#E9E7E1"} 22%, #fbfbf9)` }}>
        <div className="container-lj">
          <p className="eyebrow">{m.catalog.fragranceFamily}</p>
          <h1 className="mt-2 text-display font-extrabold">{family.name}</h1>
          {family.description ? <p className="mt-4 max-w-xl text-lg text-ink-2">{family.description}</p> : null}
        </div>
      </header>
      <div className="container-lj py-10">
        <ProductGrid products={products} locale={locale} favorites={favorites} priorityCount={2} listName={`family:${family.slug}`} />
      </div>
    </div>
  );
}
