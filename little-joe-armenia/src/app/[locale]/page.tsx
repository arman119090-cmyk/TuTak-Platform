import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { env } from "@/lib/env";
import { paths } from "@/lib/paths";
import { alternates } from "@/lib/seo/jsonld";
import { allVisibleCards, highlighted, pickT, type ProductCardDTO } from "@/lib/catalog";
import { homeContent, latestReviews, lifestyleMedia, verifiedBrandClaims } from "@/lib/home";
import { favoriteIds } from "@/lib/domain/favorites";
import { ProductGrid } from "@/components/product/product-grid";
import { ProductImage } from "@/components/product/product-image";
import { Stars } from "@/components/product/stars";
import { SkyScene } from "@/components/ui/sky-scene";
import { BRAND_TAGLINE } from "@/components/layout/site-header";
import { IconArrow, IconCar, IconCard, IconChat, IconClock, IconHeart, IconSparkle, IconTruck, IconUser } from "@/components/ui/icons";

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

/** Splits a CMS headline at its first comma so the second half can be set in brand blue. */
function splitHeadline(title: string): [string, string] {
  const i = title.search(/[,،՝]/);
  if (i < 0 || i > title.length - 3) return [title, ""];
  return [title.slice(0, i + 1), title.slice(i + 1).trim()];
}

export default async function HomePage({ params }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const [home, bestsellers, all, claims, reviews, lifestyle, favorites] = await Promise.all([
    homeContent(locale),
    highlighted("bestseller", locale, 6),
    allVisibleCards(locale),
    verifiedBrandClaims(locale),
    latestReviews(6),
    lifestyleMedia(locale),
    favoriteIds(),
  ]);

  const madeInItaly = claims.some((c) => c.key === "made-in-italy");
  const heroProduct = home.featured[0] ?? bestsellers[0] ?? all[0] ?? null;
  // Popular row: bestsellers first, topped up with featured/other in-stock items to six.
  const popular: ProductCardDTO[] = [...bestsellers];
  for (const p of [...home.featured, ...all]) {
    if (popular.length >= 6) break;
    if (!popular.some((x) => x.id === p.id) && p.available > 0) popular.push(p);
  }
  const quizProduct = all.find((p) => p.slug.includes("cherry")) ?? all.find((p) => p.id !== heroProduct?.id) ?? null;
  // One character per collection for the family banner.
  const family: ProductCardDTO[] = [];
  for (const p of all) if (p.image && !family.some((f) => f.collectionSlug === p.collectionSlug)) family.push(p);
  const joeColours = all.filter((p) => p.collectionSlug === "little-joe" && p.image).slice(0, 4);
  const heroTitle = home.hero?.title ?? `${m.home.heroLine1} ${m.home.heroLine2}`;
  const [line1, line2] = home.hero ? splitHeadline(heroTitle) : [m.home.heroLine1, m.home.heroLine2];

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <SkyScene className="absolute inset-0 h-full w-full" id="hero-sky" horizon={0.78} />
        <div className="absolute inset-y-0 left-0 hidden w-[58%] bg-gradient-to-r from-white/90 via-white/60 to-transparent md:block" aria-hidden="true" />
        <div className="container-lj relative grid items-center gap-2 pt-8 pb-10 md:min-h-[34rem] md:grid-cols-[1.05fr_1fr] md:py-14">
          <div className="relative z-[1] max-w-xl">
            <h1 className="hand text-[clamp(2.6rem,1.6rem+4.6vw,5.2rem)] leading-[0.95]">
              <span className="block">{line1}</span>
              {line2 ? <span className="block text-brand">{line2}</span> : null}
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-2">{home.hero?.body ?? m.home.heroSub}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={paths.shop(locale)} className="btn btn-primary">
                {m.home.goShop}
                <IconArrow width={18} height={18} />
              </Link>
              <Link href={paths.finder(locale)} className="btn btn-ghost">
                <IconSparkle width={18} height={18} />
                {m.home.ctaFind}
              </Link>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
              {madeInItaly ? (
                <li className="flex items-center gap-2">
                  <ItalyFlag />
                  {m.home.perkItaly}
                </li>
              ) : null}
              <li className="flex items-center gap-2">
                <IconHeart width={18} height={18} className="text-bad" />
                {m.home.perkFavorite}
              </li>
              <li className="flex items-center gap-2">
                <IconCar width={18} height={18} className="text-brand" />
                {m.home.perkTrips}
              </li>
            </ul>
          </div>

          {heroProduct?.image ? (
            <Link href={paths.product(locale, heroProduct.slug)} className="group relative mx-auto block w-full max-w-[16rem] sm:max-w-[22rem] md:max-w-[30rem]" aria-label={heroProduct.name}>
              <div className="relative aspect-[5/6]">
                <div className="absolute inset-[4%] transition-transform duration-700 group-hover:-translate-y-2 motion-reduce:transform-none">
                  <ProductImage media={heroProduct.image} accent="transparent" fit="contain" sizes="(min-width: 768px) 38vw, 80vw" priority className="drop-shadow-[0_24px_30px_rgba(20,60,120,0.25)]" />
                </div>
                <p className="hand absolute right-0 top-[38%] rotate-[-8deg] text-[clamp(1.4rem,1rem+1.5vw,2.2rem)] leading-tight text-ink" aria-hidden="true">
                  Put a smile
                  <br />
                  in the air!
                  <IconHeart width={26} height={26} filled className="ml-1 inline text-bad" />
                </p>
                {madeInItaly ? (
                  <span className="absolute bottom-[8%] right-[4%] grid place-items-center rounded-2xl bg-white px-3 py-2 text-center text-[0.65rem] font-extrabold leading-tight shadow-[var(--shadow-card)]">
                    <ItalyFlag big />
                    MADE
                    <br />
                    IN ITALY
                  </span>
                ) : null}
              </div>
              <span className="sr-only">{BRAND_TAGLINE}</span>
            </Link>
          ) : null}
        </div>
      </section>

      {/* ── Trust strip ── */}
      <section className="container-lj relative z-[1] -mt-6 md:-mt-10">
        <ul className="card grid grid-cols-2 gap-4 p-4 md:grid-cols-4 md:p-6">
          <Trust icon={<IconTruck />} title={m.home.trustDeliveryTitle} body={m.home.trustDeliveryBody} href={paths.page(locale, "delivery")} />
          <Trust icon={<IconCard />} title={m.home.trustPaymentTitle} body={m.home.trustPaymentBody} href={paths.page(locale, "payment")} />
          <Trust icon={<IconSparkle />} title={m.home.trustFinderTitle} body={m.home.trustFinderBody} href={paths.finder(locale)} />
          <Trust icon={<IconChat />} title={m.home.trustSupportTitle} body={m.home.trustSupportBody} href={paths.page(locale, "contact")} />
        </ul>
      </section>

      {/* ── Popular scents ── */}
      {popular.length > 0 ? (
        <section className="container-lj py-12 md:py-16" aria-labelledby="popular-title">
          <SectionHead id="popular-title" title={m.home.popularTitle} href={paths.shop(locale)} cta={m.common.seeAll} />
          <ProductGrid products={popular} locale={locale} favorites={favorites} listName="popular" columns="six" priorityCount={2} />
        </section>
      ) : null}

      {/* ── Scent quiz banner ── */}
      <section className="container-lj pb-12 md:pb-16">
        <div className="relative overflow-hidden rounded-[2rem] shadow-[var(--shadow-card)]">
          <SkyScene className="absolute inset-0 h-full w-full" id="quiz-sky" horizon={0.82} />
          <div className="relative grid items-center gap-4 px-6 py-10 md:grid-cols-[1.3fr_1fr] md:px-14 md:py-12">
            <div className="text-center md:text-left">
              <h2 className="hand text-[clamp(2.2rem,1.5rem+2.6vw,3.6rem)] leading-none">{m.home.quizTitle}</h2>
              <p className="mx-auto mt-3 max-w-md text-ink-2 md:mx-0">{m.home.quizBody}</p>
              <Link href={paths.finder(locale)} className="btn btn-primary mt-6">
                {m.home.quizCta}
                <IconArrow width={18} height={18} />
              </Link>
              <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs font-medium text-ink-2 md:justify-start">
                <li className="flex items-center gap-1.5">
                  <IconClock width={16} height={16} className="text-brand" />
                  {m.home.quizPoint1}
                </li>
                <li className="flex items-center gap-1.5">
                  <IconUser width={16} height={16} className="text-brand" />
                  {m.home.quizPoint2}
                </li>
                <li className="flex items-center gap-1.5">
                  <IconHeart width={16} height={16} className="text-brand" />
                  {m.home.quizPoint3}
                </li>
              </ul>
            </div>
            {quizProduct?.image ? (
              <div className="relative mx-auto aspect-square w-full max-w-[20rem]">
                <ProductImage media={quizProduct.image} accent="transparent" fit="contain" sizes="(min-width: 768px) 25vw, 70vw" className="drop-shadow-[0_18px_24px_rgba(120,20,20,0.25)]" />
                <p className="hand absolute -right-2 top-0 max-w-[9rem] rotate-[8deg] text-xl leading-tight md:-right-8 md:text-2xl" aria-hidden="true">
                  {m.home.quizBubble}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Family / brand banner ── */}
      {family.length > 0 ? (
        <section className="container-lj pb-12 md:pb-16" aria-labelledby="family-title" id="family">
          <div className="relative overflow-hidden rounded-[2rem] shadow-[var(--shadow-card)]">
            <SkyScene className="absolute inset-0 h-full w-full" id="family-sky" horizon={0.9} />
            <div className="relative grid items-end gap-6 px-6 pt-10 md:grid-cols-[1.4fr_1fr] md:px-12">
              <ul className="flex items-end justify-center gap-1 md:justify-start" aria-label={m.home.familyTitle}>
                {[...joeColours, ...family.filter((f) => f.collectionSlug !== "little-joe")].slice(0, 8).map((p, i) => (
                  <li key={p.id} className={i % 2 ? "w-[16%] max-w-[7rem] pb-2" : "w-[18%] max-w-[8rem]"}>
                    <Link href={paths.product(locale, p.slug)} className="block transition-transform duration-300 hover:-translate-y-2 motion-reduce:transform-none" title={p.name}>
                      <div className="aspect-[4/5]">
                        <ProductImage media={p.image} accent="transparent" fit="contain" sizes="120px" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="pb-10 text-center md:text-left">
                <h2 id="family-title" className="hand text-[clamp(2rem,1.4rem+2.4vw,3.2rem)] leading-none">
                  {m.home.familyBannerTitle}
                </h2>
                <p className="mt-3 text-ink-2">{m.home.familyBannerBody}</p>
                <ul className="mt-5 flex flex-wrap justify-center gap-2 md:justify-start">
                  {family.map((f) => (
                    <li key={f.collectionSlug}>
                      <Link href={paths.collection(locale, f.collectionSlug)} className="chip bg-white/80">
                        {f.collectionName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Campaign blocks (CMS) ── */}
      {home.campaigns.length > 0 ? (
        <section className="container-lj grid gap-4 pb-12 md:grid-cols-2">
          {home.campaigns.map((c) => (
            <Link
              key={c.id}
              href={c.href && c.href.startsWith("/") ? `/${locale}${c.href}` : paths.shop(locale)}
              className="rounded-[2rem] p-8 shadow-[var(--shadow-card)] md:p-12"
              style={{ background: c.accent ?? "var(--color-brand-50)" }}
            >
              <h2 className="hand text-4xl">{c.title}</h2>
              {c.body ? <p className="mt-3 max-w-md">{c.body}</p> : null}
            </Link>
          ))}
        </section>
      ) : null}

      {/* ── Brand facts: only claims verified in the admin ── */}
      {claims.length > 0 ? (
        <section className="container-lj pb-12" aria-labelledby="story-title">
          <h2 id="story-title" className="mb-6 text-h2 font-extrabold">
            {m.home.storyTitle}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {claims.map((c) => (
              <li key={c.key} className="card p-5">
                <p className="font-bold">{c.title}</p>
                {c.body ? <p className="mt-2 text-sm text-ink-2">{c.body}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Reviews: real, approved ones only ── */}
      {reviews.length > 0 ? (
        <section className="container-lj pb-12" aria-labelledby="reviews-title">
          <h2 id="reviews-title" className="mb-6 text-h2 font-extrabold">
            {m.home.reviewsTitle}
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="card p-6">
                <Stars value={r.rating} label={`${r.rating}/5`} />
                <p className="mt-3 line-clamp-5 text-ink-2">{r.body}</p>
                <p className="mt-4 text-sm font-semibold">
                  {r.authorName}
                  <span className="font-normal text-muted"> · {pickT(r.product.translations, locale)?.name}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Lifestyle imagery (authorised assets only) ── */}
      {lifestyle.length > 0 ? (
        <section className="container-lj pb-12" aria-labelledby="social-title">
          <h2 id="social-title" className="mb-6 text-h2 font-extrabold">
            {m.home.socialTitle}
          </h2>
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
        </section>
      ) : null}
    </>
  );
}

function Trust({ icon, title, body, href }: { icon: React.ReactNode; title: string; body: string; href: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-2xl p-1 hover:bg-sky-2">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-50 text-brand">{icon}</span>
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-tight">{title}</span>
          <span className="block text-xs text-muted">{body}</span>
        </span>
      </Link>
    </li>
  );
}

function SectionHead({ id, title, href, cta }: { id: string; title: string; href?: string; cta?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <h2 id={id} className="text-h2 font-extrabold">
        {title}
      </h2>
      {href && cta ? (
        <Link href={href} className="tap inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
          {cta}
          <IconArrow width={16} height={16} />
        </Link>
      ) : null}
    </div>
  );
}

function ItalyFlag({ big }: { big?: boolean }) {
  return (
    <svg width={big ? 28 : 18} height={big ? 20 : 13} viewBox="0 0 3 2" aria-hidden="true" className={big ? "mb-1 rounded-[3px]" : "rounded-[2px]"}>
      <rect width="1" height="2" fill="#009246" />
      <rect x="1" width="1" height="2" fill="#fff" />
      <rect x="2" width="1" height="2" fill="#ce2b37" />
    </svg>
  );
}
