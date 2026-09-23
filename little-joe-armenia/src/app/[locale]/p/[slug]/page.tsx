import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fmt, getMessages, type Messages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { paths } from "@/lib/paths";
import { absolute, alternates, breadcrumbLd, productLd } from "@/lib/seo/jsonld";
import { getProduct, sameCollection, similarProducts, type ProductDetail } from "@/lib/catalog";
import { favoriteIds } from "@/lib/domain/favorites";
import { SCENT_AXES } from "@/lib/domain/scent";
import { Gallery } from "@/components/product/gallery";
import { BuyBox } from "@/components/product/buy-box";
import { FavoriteButton } from "@/components/product/favorite-button";
import { CompareToggle, ShareButton } from "@/components/product/product-actions";
import { ProductGrid } from "@/components/product/product-grid";
import { ReviewForm } from "@/components/product/review-form";
import { Stars } from "@/components/product/stars";
import { TrackOnMount } from "@/components/analytics/track-on-mount";
import { JsonLd } from "@/components/ui/json-ld";
import { IconCard, IconChevron, IconTruck } from "@/components/ui/icons";
import { ProductTabs } from "@/components/product/product-tabs";

type Props = { params: Promise<{ locale: string; slug: string }> };

async function load(params: Props["params"]) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const product = await getProduct(slug, locale);
  if (!product) notFound();
  return { locale, product };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, product } = await load(params);
  const t = product.t;
  const title = t?.seoTitle ?? `${product.name} — ${product.collection.name}`;
  const description = t?.seoDescription ?? t?.profileDescription ?? `${product.name}. ${product.collection.name}.`;
  const image = product.media[0];
  return {
    title,
    description,
    alternates: alternates(locale, (l) => paths.product(l, product.slug)),
    openGraph: {
      title,
      description,
      url: paths.product(locale, product.slug),
      images: image && !image.url.includes(".svg") ? [{ url: absolute(image.url), width: image.width, height: image.height, alt: image.alt }] : undefined,
    },
    twitter: { card: "summary_large_image", title, description },
    // Demo products must never be indexed.
    robots: product.isDemo ? { index: false, follow: true } : undefined,
  };
}

export default async function ProductPage({ params }: Props) {
  const { locale, product } = await load(params);
  const m = getMessages(locale);
  const [similar, family, favorites] = await Promise.all([
    similarProducts(product.id, locale),
    sameCollection(product.collection.id, product.id, locale),
    favoriteIds(),
  ]);
  const similarIds = new Set(similar.map((p) => p.id));
  const more = family.filter((p) => !similarIds.has(p.id));
  const v = product.variants.find((x) => x.priceAmd !== null);
  const accent = product.card.accent;

  return (
    <div style={{ ["--accent" as string]: accent, ["--accent-ink" as string]: product.card.accentInk }}>
      <JsonLd
        data={[
          productLd({
            name: product.name,
            path: paths.product(locale, product.slug),
            description: product.t?.profileDescription ?? product.verified.officialDescription,
            images: product.media.filter((i) => !i.isPlaceholder).map((i) => i.url),
            sku: v?.sku ?? null,
            gtin13: product.verified.ean && product.verified.ean.length === 13 ? product.verified.ean : null,
            mpn: product.verified.articleNumber,
            brand: "Little Joe",
            collection: product.collection.name,
            priceAmd: v?.priceAmd ?? null,
            available: (v?.available ?? 0) > 0,
            rating: product.rating,
            reviews: product.reviews,
          }),
          breadcrumbLd([
            { name: m.nav.home, path: paths.home(locale) },
            { name: product.collection.name, path: paths.collection(locale, product.collection.slug) },
            { name: product.name, path: paths.product(locale, product.slug) },
          ]),
        ]}
      />
      <TrackOnMount
        event="view_item"
        params={{ currency: "AMD", value: v?.priceAmd ?? 0, items: [{ item_id: product.slug, item_name: product.name, price: v?.priceAmd ?? 0, item_category: product.collection.name }] }}
      />
      <div className="container-lj pt-4 md:pt-8">
        <nav aria-label={m.brand.breadcrumb} className="text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href={paths.home(locale)} className="hover:text-ink">
                {m.nav.home}
              </Link>
            </li>
            <li aria-hidden="true">
              <IconChevron width={14} height={14} />
            </li>
            <li>
              <Link href={paths.collection(locale, product.collection.slug)} className="hover:text-ink">
                {product.collection.name}
              </Link>
            </li>
          </ol>
        </nav>

        <div className="mt-4 grid gap-8 md:grid-cols-2 md:gap-12 lg:gap-16">
          <Gallery media={product.media} accent={accent} name={product.name} />

          <div className="min-w-0">
            <Link href={paths.collection(locale, product.collection.slug)} className="eyebrow hover:text-ink">
              {product.collection.name}
            </Link>
            <div className="mt-2 flex items-start justify-between gap-4">
              <h1 className="display text-h1 text-balance">{product.name}</h1>
              <FavoriteButton productId={product.id} initial={favorites.has(product.id)} variant="inline" />
            </div>
            {product.rating ? (
              <a href="#reviews" className="mt-2 inline-flex items-center gap-2 text-sm">
                <Stars value={product.rating.average} label={fmt(m.reviews.average, { rating: product.rating.average.toFixed(1) })} />
                <span className="text-muted">{fmt(m.reviews.count, { count: product.rating.count })}</span>
              </a>
            ) : null}
            {product.family ? (
              <p className="mt-3 text-ink-2">
                <Link href={paths.family(locale, product.family.slug)} className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  {product.family.name}
                </Link>
                {product.tags.length ? <span className="text-muted"> · {product.tags.join(" · ")}</span> : null}
              </p>
            ) : null}
            {product.t?.profileDescription ? <p className="mt-4 max-w-prose leading-relaxed text-ink-2">{product.t.profileDescription}</p> : null}

            <BuyBox variants={product.variants} name={product.name} slug={product.slug} collection={product.collection.name} />

            <div className="mt-4 flex flex-wrap gap-1">
              <ShareButton title={product.name} />
              <CompareToggle productId={product.id} />
            </div>

            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              <li className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-line">
                <span className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--color-hairline)]/50 text-[var(--color-hairline)]">
                  <IconTruck width={20} height={20} />
                </span>
                <span className="text-sm font-semibold">{m.product.perkDelivery}</span>
              </li>
              <li className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-line">
                <span className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--color-hairline)]/50 text-[var(--color-hairline)]">
                  <IconCard width={20} height={20} />
                </span>
                <span className="text-sm font-semibold">{m.product.perkPayment}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <section id="reviews" className="container-lj mt-12" aria-label={m.product.facts}>
        <ProductTabs
          tabs={[
            {
              id: "description",
              label: m.product.tabDescription,
              content: (
                <div className="max-w-3xl space-y-4">
                  {product.verified.officialDescription ? (
                    <p className="whitespace-pre-line leading-relaxed text-ink-2">{product.verified.officialDescription}</p>
                  ) : product.t?.profileDescription ? null : (
                    <p className="text-ink-2">{m.product.noDescription}</p>
                  )}
                  {product.t?.usage ? (
                    <div>
                      <h3 className="mb-1 font-bold">{m.product.howToUse}</h3>
                      <p className="whitespace-pre-line leading-relaxed text-ink-2">{product.t.usage}</p>
                    </div>
                  ) : null}
                  <ScentProfile product={product} m={m} />
                </div>
              ),
            },
            { id: "specs", label: m.product.tabSpecs, content: <FactsTable product={product} m={m} /> },
            {
              id: "delivery",
              label: m.product.tabDelivery,
              content: (
                <div className="max-w-3xl space-y-3 text-ink-2">
                  <p>{m.product.deliveryInfoBody}</p>
                  <p className="flex flex-wrap gap-x-5 gap-y-2">
                    <Link href={paths.page(locale, "delivery")} className="font-semibold text-brand underline-offset-4 hover:underline">
                      {m.pages.delivery}
                    </Link>
                    <Link href={paths.page(locale, "payment")} className="font-semibold text-brand underline-offset-4 hover:underline">
                      {m.pages.payment}
                    </Link>
                    <Link href={paths.page(locale, "returns")} className="font-semibold text-brand underline-offset-4 hover:underline">
                      {m.pages.returns}
                    </Link>
                    <Link href={paths.page(locale, "faq")} className="font-semibold text-brand underline-offset-4 hover:underline">
                      {m.pages.faq}
                    </Link>
                  </p>
                </div>
              ),
            },
            {
              id: "reviews",
              label: product.rating ? `${m.product.reviews} (${product.rating.count})` : m.product.reviews,
              content: (
                <div className="grid gap-10 md:grid-cols-[1fr_1.3fr]">
                  <div>
                    {product.rating ? (
                      <p className="mb-4 text-ink-2">
                        {fmt(m.reviews.average, { rating: product.rating.average.toFixed(1) })} · {fmt(m.reviews.count, { count: product.rating.count })}
                      </p>
                    ) : null}
                    <h3 className="mb-4 font-bold">{m.product.writeReview}</h3>
                    <ReviewForm productId={product.id} />
                  </div>
                  <div>
                    {product.reviews.length === 0 ? (
                      <p className="text-ink-2">{m.product.noReviews}</p>
                    ) : (
                      <ul className="space-y-6">
                        {product.reviews.map((r) => (
                          <li key={r.id} className="border-b border-line pb-6">
                            <Stars value={r.rating} label={`${r.rating}/5`} />
                            <p className="mt-2 whitespace-pre-line leading-relaxed">{r.body}</p>
                            <p className="mt-3 text-sm font-semibold">
                              {r.authorName}
                              {r.verifiedPurchase ? <span className="ml-2 font-normal text-ok">{m.reviews.verifiedPurchase}</span> : null}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ),
            },
          ]}
        />
      </section>

      {similar.length > 0 ? (
        <section className="container-lj mt-20" aria-labelledby="similar-h">
          <h2 id="similar-h" className="display mb-8 text-h2">
            {m.product.similarScents}
          </h2>
          <ProductGrid products={similar} locale={locale} favorites={favorites} listName="similar" />
        </section>
      ) : null}
      {more.length > 0 ? (
        <section className="container-lj mt-20" aria-labelledby="more-h">
          <h2 id="more-h" className="display mb-8 text-h2">
            {similar.length > 0 ? fmt(m.product.fromFamily, { collection: product.collection.name }) : m.product.youMayLike}
          </h2>
          <ProductGrid products={more} locale={locale} favorites={favorites} listName="same-collection" />
        </section>
      ) : null}
    </div>
  );
}


function ScentProfile({ product, m }: { product: ProductDetail; m: Messages }) {
  const s = product.scent;
  const axes = SCENT_AXES.filter((a) => s[a] !== null);
  if (axes.length === 0 && s.intensity === null) {
    return <p className="mt-8 rounded-2xl bg-mist px-4 py-3 text-sm text-ink-2">{m.product.profilePending}</p>;
  }
  return (
    <section className="mt-8" aria-labelledby="profile-h">
      <h2 id="profile-h" className="mb-4 font-bold">
        {m.product.scentProfile}
      </h2>
      {s.intensity !== null ? (
        <p className="mb-4 text-sm">
          <span className="text-muted">{m.product.intensity}: </span>
          <span className="font-semibold">{m.product.intensityLevels[String(s.intensity) as "1"]}</span>
        </p>
      ) : null}
      <dl className="space-y-3">
        {axes.map((a) => (
          <div key={a} className="grid grid-cols-[6rem_1fr] items-center gap-3">
            <dt className="text-sm text-ink-2">{m.product.axes[a]}</dt>
            <dd className="h-2 overflow-hidden rounded-full bg-mist" aria-label={`${s[a]}/5`}>
              <div className="h-full rounded-full" style={{ width: `${((s[a] ?? 0) / 5) * 100}%`, background: "var(--accent)" }} />
            </dd>
          </div>
        ))}
      </dl>
      {!s.profileVerified ? <p className="mt-3 text-xs text-muted">{m.common.notConfirmed}</p> : null}
    </section>
  );
}

function FactsTable({ product, m }: { product: ProductDetail; m: Messages }) {
  const v = product.variants[0];
  const rows: [string, string | null][] = [
    [m.product.collection, product.collection.name],
    [m.product.fragranceFamily, product.family?.name ?? null],
    [m.product.format, product.format ? m.product.formats[product.format] : null],
    [m.product.sku, v?.sku ?? null],
    [m.product.ean, product.verified.ean],
    [m.product.dimensions, product.verified.dimensions],
  ];
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows
          .filter(([, val]) => val !== null)
          .map(([k, val]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="font-medium">{val}</dd>
            </div>
          ))}
      </dl>
      {product.verified.durationDays !== null ? (
        <p className="mt-3 text-sm font-medium">{fmt(m.product.duration, { days: product.verified.durationDays })}</p>
      ) : null}
      {product.facts.length === 0 ? <p className="mt-3 text-xs text-muted">{m.common.notConfirmed}</p> : null}
    </>
  );
}
