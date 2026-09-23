import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { env } from "@/lib/env";
import { paths } from "@/lib/paths";
import { alternates } from "@/lib/seo/jsonld";
import { highlighted, pickT, visibleCollections } from "@/lib/catalog";
import { homeContent, latestReviews, lifestyleMedia, verifiedBrandClaims } from "@/lib/home";
import { favoriteIds } from "@/lib/domain/favorites";
import { ProductGrid } from "@/components/product/product-grid";
import { ProductImage } from "@/components/product/product-image";
import { ScentSelector } from "@/components/home/scent-selector";
import { Stars } from "@/components/product/stars";
import { IconArrow } from "@/components/ui/icons";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  return {
    title: { absolute: `${m.meta.homeTitle} · ${env().STORE_NAME}` },
    description: m.meta.siteDescription,
    alternates: alternates(locale, (l) => paths.home(l)),
    openGraph: { title: m.meta.homeTitle, description: m.meta.siteDescription, url: paths.home(locale) },
  };
}

export default async function HomePage({ params }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const [home, bestsellers, collections, claims, reviews, lifestyle, favorites] = await Promise.all([
    homeContent(locale),
    highlighted("bestseller", locale, 8),
    visibleCollections(locale),
    verifiedBrandClaims(locale),
    latestReviews(6),
    lifestyleMedia(locale),
    favoriteIds(),
  ]);
  const heroPool = home.featured.length ? home.featured : bestsellers;
  const heroProduct = heroPool[0] ?? null;
  const heroTrio = heroPool.slice(0, 3);
  const heroAccent = home.hero?.accent ?? heroProduct?.accent ?? "#E9E7E1";
  const demo = env().DEMO_MODE;

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="container-lj grid min-h-[min(88svh,52rem)] items-center gap-8 py-10 md:grid-cols-[1.05fr_1fr] md:py-16">
          <div className="max-w-xl">
            <p className="eyebrow">{m.home.heroEyebrow}</p>
            <h1 className="mt-4 text-display font-extrabold text-balance">{home.hero?.title ?? m.home.heroTitle}</h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-2">{home.hero?.body ?? m.home.heroBody}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={paths.finder(locale)} className="btn btn-primary">
                {m.home.ctaFind}
              </Link>
              <Link href={paths.shop(locale)} className="btn btn-ghost">
                {m.home.ctaShop}
              </Link>
            </div>
          </div>
          {heroProduct ? (
            <div className="relative mx-auto w-full max-w-[36rem]">
              <div
                className="absolute inset-[6%] rounded-full blur-3xl"
                style={{ background: `color-mix(in oklab, ${heroAccent} 45%, transparent)` }}
                aria-hidden="true"
              />
              {/* Composition: the lead scent large, two more peeking in. */}
              <div className="relative aspect-square">
                {heroTrio.slice(1).map((p, i) => (
                  <Link
                    key={p.id}
                    href={paths.product(locale, p.slug)}
                    aria-label={p.name}
                    className={`absolute w-[42%] overflow-hidden rounded-[1.75rem] shadow-[var(--shadow-float)] transition-transform duration-500 hover:-translate-y-1 motion-reduce:transform-none ${
                      i === 0 ? "left-0 top-[4%] -rotate-6" : "right-0 bottom-[2%] rotate-6"
                    }`}
                    style={{ background: p.accent }}
                  >
                    <div className="aspect-square">
                      <ProductImage media={p.image} accent={p.accent} sizes="(min-width: 768px) 20vw, 40vw" />
                    </div>
                  </Link>
                ))}
                <Link
                  href={paths.product(locale, heroProduct.slug)}
                  aria-label={heroProduct.name}
                  className="absolute inset-[14%] overflow-hidden rounded-[2.25rem] shadow-[var(--shadow-float)]"
                  style={{ background: heroAccent }}
                >
                  <ProductImage media={heroProduct.image} accent={heroAccent} sizes="(min-width: 768px) 34vw, 72vw" priority />
                </Link>
              </div>
              <p className="mt-2 text-center text-sm font-medium text-muted">
                {heroProduct.name}
                {heroProduct.image?.isPlaceholder ? <span className="block text-xs">{m.common.placeholderImage}</span> : null}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Choose your Joe ── */}
      {home.featured.length > 1 ? <ScentSelector products={home.featured} title={m.home.chooseTitle} body={m.home.chooseBody} /> : null}

      {/* ── Scent finder ── */}
      <section className="container-lj py-16 md:py-24">
        <div className="grid gap-8 rounded-[2rem] bg-ink px-6 py-12 text-white md:grid-cols-[1.4fr_1fr] md:items-center md:px-14 md:py-16">
          <div>
            <h2 className="text-h2 font-extrabold">{m.home.finderTitle}</h2>
            <p className="mt-3 max-w-lg text-white/75">{m.home.finderBody}</p>
          </div>
          <div className="md:text-right">
            <Link href={paths.finder(locale)} className="btn bg-white text-ink hover:bg-white/90">
              {m.home.finderCta}
              <IconArrow width={18} height={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Bestsellers ── */}
      {bestsellers.length > 0 ? (
        <section className="container-lj py-8" aria-labelledby="best-title">
          <SectionHead id="best-title" title={m.home.bestsellersTitle} href={paths.shop(locale, "bestseller=1")} cta={m.common.seeAll} />
          <ProductGrid products={bestsellers} locale={locale} favorites={favorites} listName="bestsellers" />
        </section>
      ) : null}

      {/* ── Campaign blocks (CMS) ── */}
      {home.campaigns.length > 0 ? (
        <section className="container-lj grid gap-4 py-12 md:grid-cols-2">
          {home.campaigns.map((c) => (
            <Link
              key={c.id}
              href={c.href && c.href.startsWith("/") ? `/${locale}${c.href}` : paths.shop(locale)}
              className="rounded-[2rem] p-8 md:p-12"
              style={{ background: c.accent ?? "var(--color-mist)" }}
            >
              <h2 className="text-h2 font-extrabold">{c.title}</h2>
              {c.body ? <p className="mt-3 max-w-md">{c.body}</p> : null}
            </Link>
          ))}
        </section>
      ) : null}

      {/* ── Meet the family: only collections that have products ── */}
      {collections.length > 1 ? (
        <section id="family" className="container-lj py-16" aria-labelledby="family-title">
          <SectionHead id="family-title" title={m.home.familyTitle} />
          <ul className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-4 md:px-0">
            {collections.map((c) => (
              <li key={c.id} className="w-[70vw] shrink-0 snap-start md:w-auto">
                <Link href={paths.collection(locale, c.slug)} className="flex aspect-[4/5] flex-col justify-end rounded-[var(--radius-card)] p-6" style={{ background: c.accent }}>
                  <span className="text-2xl font-extrabold">{c.name}</span>
                  <span className="mt-1 text-sm opacity-80">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Brand story: verified claims only ── */}
      <section className="container-lj py-16" aria-labelledby="story-title">
        <div className="grid gap-10 md:grid-cols-[1fr_1.4fr]">
          <h2 id="story-title" className="text-h2 font-extrabold">
            {m.home.storyTitle}
          </h2>
          {claims.length > 0 ? (
            <ul className="grid gap-6 sm:grid-cols-2">
              {claims.map((c) => (
                <li key={c.key} className="border-t border-line pt-4">
                  <p className="text-lg font-bold">{c.title}</p>
                  {c.body ? <p className="mt-2 text-ink-2">{c.body}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="max-w-lg text-ink-2">{m.home.storyEmpty}</p>
          )}
        </div>
      </section>

      {/* ── Reviews ── */}
      <section className="container-lj py-16" aria-labelledby="reviews-title">
        <SectionHead id="reviews-title" title={m.home.reviewsTitle} />
        {reviews.length > 0 ? (
          <ul className="grid gap-4 md:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-[var(--radius-card)] bg-card p-6 ring-1 ring-line">
                <Stars value={r.rating} label={`${r.rating}/5`} />
                <p className="mt-3 line-clamp-5 text-ink-2">{r.body}</p>
                <p className="mt-4 text-sm font-semibold">
                  {r.authorName}
                  <span className="font-normal text-muted"> · {pickT(r.product.translations, locale)?.name}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-2">{m.home.reviewsEmpty}</p>
        )}
      </section>

      {/* ── Lifestyle imagery (authorised assets only) ── */}
      {lifestyle.length > 0 || demo ? (
        <section className="container-lj py-16" aria-labelledby="social-title">
          <SectionHead id="social-title" title={m.home.socialTitle} />
          {lifestyle.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {lifestyle.map((img) => (
                <li key={img.id} className="aspect-square overflow-hidden rounded-[var(--radius-card)]">
                  <ProductImage
                    media={{ url: img.url, width: img.width, height: img.height, alt: img.alt, kind: "LIFESTYLE", isPlaceholder: false }}
                    accent="#E9E7E1"
                    sizes="(min-width: 768px) 30vw, 48vw"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-2">{m.home.socialEmpty}</p>
          )}
        </section>
      ) : null}
    </>
  );
}

function SectionHead({ id, title, href, cta }: { id: string; title: string; href?: string; cta?: string }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <h2 id={id} className="text-h2 font-extrabold">
        {title}
      </h2>
      {href && cta ? (
        <Link href={href} className="tap inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline">
          {cta}
          <IconArrow width={16} height={16} />
        </Link>
      ) : null}
    </div>
  );
}
