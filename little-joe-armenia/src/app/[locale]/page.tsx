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
import { ARM_NUMERALS, Ararat, Braid, Rosette } from "@/components/ui/armenia";
import { BRAND_TAGLINE } from "@/components/layout/site-header";
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
  const sidekicks = family.filter((f) => f.collectionSlug !== "little-joe").slice(0, 2);
  // Collection tiles: a representative character per collection.
  const collectionTiles = family;
  const heroTitle = home.hero?.title ?? `${m.home.heroLine1} ${m.home.heroLine2}`;
  const [line1, line2] = home.hero ? splitHeadline(heroTitle) : [m.home.heroLine1, m.home.heroLine2];

  return (
    <>
      {/* ── Hero: serif headline, the character in an arch before Ararat ── */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute right-[-20%] top-[-10%] h-[80%] w-[80%] rounded-full opacity-70 blur-3xl md:right-[-5%] md:w-[55%]"
          style={{ background: "radial-gradient(closest-side, rgb(233 170 110 / 0.35), rgb(233 170 110 / 0))" }}
          aria-hidden="true"
        />
        <Ararat className="pointer-events-none absolute bottom-0 right-0 h-[34%] w-full opacity-70 md:h-[46%] md:w-[62%]" id="hero-ararat" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line" aria-hidden="true" />
        <div className="container-lj relative grid grid-cols-[minmax(0,1fr)] items-center gap-10 pt-10 pb-16 md:min-h-[40rem] md:grid-cols-[1.1fr_0.9fr] md:gap-8 md:pt-16 md:pb-24">
          <div className="relative z-[1] min-w-0 max-w-2xl">
            <p className="kicker">{m.home.heroEyebrow}</p>
            <h1 className="serif hero-title mt-5 text-[clamp(2.7rem,1.5rem+5vw,5.8rem)] leading-[0.98]">
              <span className="block">{line1}</span>
              {line2 ? <span className="block italic text-brand">{line2}</span> : null}
            </h1>
            <p className="mt-6 max-w-md text-[1.05rem] leading-relaxed text-ink-2">{home.hero?.body ?? m.home.heroSub}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3">
              <Link href={paths.shop(locale)} className="btn btn-primary px-7">
                {m.home.goShop}
                <IconArrow width={17} height={17} />
              </Link>
              <Link href={paths.finder(locale)} className="link-arrow">
                {m.home.ctaFind}
              </Link>
            </div>
            <ul className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.8rem] text-muted">
              {madeInItaly ? <li>{m.home.perkItaly}</li> : null}
              <li className="flex items-center gap-2">
                <Rosette size={14} className="text-[var(--color-gold)]" />
                {m.home.perkFavorite}
              </li>
              <li className="flex items-center gap-2">
                <Rosette size={14} className="text-[var(--color-gold)]" />
                {m.home.perkTrips}
              </li>
            </ul>
          </div>

          {heroProduct?.image ? (
            <Link href={paths.product(locale, heroProduct.slug)} className="group relative mx-auto block w-[78%] max-w-[26rem] md:w-full" aria-label={heroProduct.name}>
              <div className="arch tuff relative aspect-[4/5] shadow-[var(--shadow-lift)] ring-1 ring-[var(--color-tuff-2)]" style={{ ["--tint" as string]: heroProduct.accent }}>
                <Ararat className="absolute inset-x-0 bottom-0 h-[38%] w-full opacity-80" id="arch-ararat" />
                <div className="float-slow absolute inset-x-[14%] bottom-[10%] top-[14%] transition-transform duration-700 group-hover:-translate-y-2 motion-reduce:transform-none">
                  <ProductImage
                    media={heroProduct.image}
                    accent="transparent"
                    fit="contain"
                    sizes="(min-width: 768px) 34vw, 78vw"
                    priority
                    className="drop-shadow-[0_28px_30px_rgba(60,30,15,0.3)]"
                  />
                </div>
              </div>
              {/* Inner hairline arch, like a carved stone frame */}
              <div className="arch pointer-events-none absolute inset-2.5 ring-1 ring-[#fff8f1]/70" aria-hidden="true" />
              {sidekicks.map((s, i) => (
                <div
                  key={s.id}
                  aria-hidden="true"
                  className={`${i === 0 ? "float-slower -left-[16%] bottom-[-2%] w-[34%] [--r:-6deg]" : "float-slow -right-[12%] bottom-[-4%] w-[30%] [--r:6deg]"} absolute aspect-[4/5] drop-shadow-[0_16px_18px_rgba(60,30,15,0.25)]`}
                >
                  <ProductImage media={s.image} accent="transparent" fit="contain" sizes="160px" />
                </div>
              ))}
              <Seal className="absolute -right-4 -top-4 size-24 md:-right-8 md:-top-6 md:size-28" />
              <span className="sr-only">{BRAND_TAGLINE}</span>
            </Link>
          ) : null}
        </div>
      </section>

      {/* ── Promise: four points numbered with Armenian letters ── */}
      <section className="border-y border-line bg-card/60">
        <ul className="container-lj grid grid-cols-2 md:grid-cols-4">
          <Trust n={0} title={m.home.trustDeliveryTitle} body={m.home.trustDeliveryBody} href={paths.page(locale, "delivery")} />
          <Trust n={1} title={m.home.trustPaymentTitle} body={m.home.trustPaymentBody} href={paths.page(locale, "payment")} />
          <Trust n={2} title={m.home.trustFinderTitle} body={m.home.trustFinderBody} href={paths.finder(locale)} />
          <Trust n={3} title={m.home.trustSupportTitle} body={m.home.trustSupportBody} href={paths.page(locale, "contact")} />
        </ul>
      </section>

      {/* ── Popular scents ── */}
      {popular.length > 0 ? (
        <section className="container-lj py-16 md:py-24" aria-labelledby="popular-title">
          <SectionHead n={0} id="popular-title" title={m.home.popularTitle} href={paths.shop(locale)} cta={m.common.seeAll} />
          <ProductGrid products={popular} locale={locale} favorites={favorites} listName="popular" columns="six" priorityCount={2} />
        </section>
      ) : null}

      {/* ── The family: one arch per character collection ── */}
      {collectionTiles.length > 1 ? (
        <section className="container-lj pb-16 md:pb-24" aria-labelledby="family-tiles-title">
          <SectionHead n={1} id="family-tiles-title" title={m.home.familyTitle} />
          <ul className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:gap-5 md:overflow-visible md:px-0">
            {collectionTiles.map((c) => (
              <li key={c.collectionSlug} className="w-[58vw] max-w-[15rem] shrink-0 snap-start md:w-auto md:max-w-none">
                <Link href={paths.collection(locale, c.collectionSlug)} className="group block">
                  <div className="arch tuff relative aspect-[3/4] ring-1 ring-[var(--color-tuff-2)]/60 transition-shadow duration-500 group-hover:shadow-[var(--shadow-lift)]" style={{ ["--tint" as string]: c.accent }}>
                    <div className="absolute inset-x-[14%] bottom-[8%] top-[18%] transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:-translate-y-2 group-hover:scale-[1.04] motion-reduce:transform-none">
                      <ProductImage media={c.image} accent="transparent" fit="contain" sizes="(min-width: 768px) 18vw, 55vw" className="drop-shadow-[0_18px_20px_rgba(60,30,15,0.25)]" />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between px-1">
                    <span className="serif text-[1.3rem]">{c.collectionName}</span>
                    <IconArrow width={16} height={16} className="text-[var(--color-gold)] transition-transform group-hover:translate-x-1" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Scent finder: Ararat at night ── */}
      <section className="container-lj pb-16 md:pb-24">
        <div className="relative overflow-hidden rounded-[2rem] bg-navy text-[#fff8f1] shadow-[var(--shadow-lift)]">
          <div className="absolute inset-0" style={{ background: "radial-gradient(90% 70% at 70% 100%, rgb(217 140 74 / 0.35), transparent 60%), radial-gradient(60% 50% at 15% 0%, rgb(138 28 44 / 0.35), transparent 70%)" }} aria-hidden="true" />
          <Ararat tone="night" className="absolute bottom-0 right-0 h-[48%] w-full md:w-[85%]" id="quiz-ararat" />
          <StarField />
          <div className="relative grid items-center gap-6 px-6 py-12 md:grid-cols-[1.25fr_1fr] md:px-16 md:py-16">
            <div className="text-center md:text-left">
              <p className="kicker justify-center md:justify-start">{m.nav.scentFinder}</p>
              <h2 className="serif mt-4 text-[clamp(2.2rem,1.5rem+2.8vw,3.8rem)] leading-[1.02]">{m.home.quizTitle}</h2>
              <p className="mx-auto mt-4 max-w-md text-[#fff8f1]/70 md:mx-0">{m.home.quizBody}</p>
              <Link href={paths.finder(locale)} className="btn mt-8 bg-[#fff8f1] px-7 text-ink hover:bg-white">
                {m.home.quizCta}
                <IconArrow width={17} height={17} />
              </Link>
              <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[0.75rem] text-[#fff8f1]/60 md:justify-start">
                {[m.home.quizPoint1, m.home.quizPoint2, m.home.quizPoint3].map((t, i) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="font-[family-name:var(--font-serif)] text-[var(--color-apricot)]">{ARM_NUMERALS[i]}</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            {quizProduct?.image ? (
              <div className="relative mx-auto aspect-square w-[70%] max-w-[20rem] md:w-full">
                <div className="absolute inset-[10%] rounded-full bg-[rgb(217_140_74/0.25)] blur-2xl" aria-hidden="true" />
                <div className="float-slow absolute inset-0">
                  <ProductImage media={quizProduct.image} accent="transparent" fit="contain" sizes="(min-width: 768px) 25vw, 70vw" className="drop-shadow-[0_24px_28px_rgba(0,0,0,0.45)]" />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Family / brand banner: the whole line-up on a stone ledge ── */}
      {family.length > 0 ? (
        <section className="container-lj pb-16 md:pb-24" aria-labelledby="family-title" id="family">
          <div className="tuff relative overflow-hidden rounded-[2rem] ring-1 ring-[var(--color-tuff-2)]">
            <Braid className="absolute inset-x-0 top-5 text-[var(--color-gold)] opacity-60" id="family-braid" />
            <div className="relative grid items-end gap-8 px-6 pt-14 md:grid-cols-[1fr_1.3fr] md:px-14">
              <div className="pb-4 text-center md:pb-14 md:text-left">
                <h2 id="family-title" className="serif text-[clamp(2rem,1.4rem+2.4vw,3.4rem)] leading-[1.02]">
                  {m.home.familyBannerTitle}
                </h2>
                <p className="mx-auto mt-4 max-w-md text-ink-2 md:mx-0">{m.home.familyBannerBody}</p>
                <Link href={paths.shop(locale)} className="link-arrow mt-5">
                  {m.home.goShop}
                  <IconArrow width={16} height={16} />
                </Link>
              </div>
              <div className="relative">
                <ul className="relative z-[1] flex items-end justify-center gap-0.5 md:justify-end" aria-label={m.home.familyTitle}>
                  {[...joeColours, ...family.filter((f) => f.collectionSlug !== "little-joe")].slice(0, 8).map((p, i) => (
                    <li key={p.id} className={i % 2 ? "w-[15%] max-w-[6.5rem] pb-1" : "w-[17%] max-w-[7.5rem]"}>
                      <Link href={paths.product(locale, p.slug)} className="block transition-transform duration-300 hover:-translate-y-2 motion-reduce:transform-none" title={p.name}>
                        <div className="aspect-[4/5] drop-shadow-[0_12px_12px_rgba(60,30,15,0.25)]">
                          <ProductImage media={p.image} accent="transparent" fit="contain" sizes="120px" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
                {/* Stone ledge */}
                <div className="h-6 rounded-t-md bg-gradient-to-b from-[var(--color-tuff-2)] to-[var(--color-tuff-deep)]/60" aria-hidden="true" />
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
              className="tuff arch-soft p-8 ring-1 ring-[var(--color-tuff-2)] md:p-12"
              style={{ ["--tint" as string]: c.accent ?? "var(--color-tuff)" }}
            >
              <h2 className="serif text-4xl">{c.title}</h2>
              {c.body ? <p className="mt-3 max-w-md">{c.body}</p> : null}
            </Link>
          ))}
        </section>
      ) : null}

      {/* ── Brand facts: only claims verified in the admin ── */}
      {claims.length > 0 ? (
        <section className="container-lj pb-12" aria-labelledby="story-title">
          <h2 id="story-title" className="serif mb-8 text-h2">
            {m.home.storyTitle}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {claims.map((c) => (
              <li key={c.key} className="border-t border-[var(--color-gold)]/50 pt-5">
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
          <h2 id="reviews-title" className="serif mb-8 text-h2">
            {m.home.reviewsTitle}
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-[1.5rem] bg-card p-7 ring-1 ring-line">
                <Stars value={r.rating} label={`${r.rating}/5`} />
                <p className="serif mt-4 line-clamp-5 text-[1.2rem] font-medium italic leading-snug text-ink">«{r.body}»</p>
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
          <h2 id="social-title" className="serif mb-8 text-h2">
            {m.home.socialTitle}
          </h2>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {lifestyle.map((img) => (
              <li key={img.id} className="arch aspect-[4/5]">
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

function Trust({ n, title, body, href }: { n: number; title: string; body: string; href: string }) {
  return (
    <li className="min-w-0 border-line [&:nth-child(2n)]:border-l md:border-l md:first:border-l-0 [&:nth-child(n+3)]:border-t md:[&:nth-child(n+3)]:border-t-0">
      <Link href={href} className="group flex h-full items-start gap-2.5 px-2 py-6 [hyphens:auto] sm:gap-3 sm:px-3 md:px-6 md:py-8">
        <span className="numeral shrink-0 !size-7 !text-[0.9rem] transition-colors group-hover:border-brand group-hover:text-brand sm:!size-9 sm:!text-[1.05rem]" aria-hidden="true">
          {ARM_NUMERALS[n]}
        </span>
        <span className="min-w-0">
          <span className="block text-[0.84rem] font-semibold leading-tight [overflow-wrap:anywhere] sm:text-[0.9rem]">{title}</span>
          <span className="mt-1 block text-[0.78rem] leading-snug text-muted">{body}</span>
        </span>
      </Link>
    </li>
  );
}

function SectionHead({ n, id, title, href, cta }: { n: number; id: string; title: string; href?: string; cta?: string }) {
  return (
    <div className="mb-9 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 md:mb-12">
      <div className="flex min-w-0 items-end gap-4">
        <span className="numeral mb-1 hidden sm:inline-grid" aria-hidden="true">
          {ARM_NUMERALS[n]}
        </span>
        <div>
          <p className="kicker">Little Joe</p>
          <h2 id={id} className="serif mt-2 text-[clamp(1.9rem,1.4rem+1.8vw,3rem)] leading-[1.05]">
            {title}
          </h2>
        </div>
      </div>
      {href && cta ? (
        <Link href={href} className="link-arrow">
          {cta}
          <IconArrow width={16} height={16} />
        </Link>
      ) : null}
    </div>
  );
}

/** Round gold seal with circular lettering. */
function Seal({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={`spin-slow ${className}`} aria-hidden="true">
      <defs>
        <path id="seal-circle" d="M60 60 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0" />
      </defs>
      <circle cx="60" cy="60" r="58" fill="#fff8f1" />
      <circle cx="60" cy="60" r="54" fill="none" stroke="#b08a57" strokeWidth="0.8" />
      <circle cx="60" cy="60" r="33" fill="none" stroke="#b08a57" strokeWidth="0.8" />
      <text fontSize="10.5" letterSpacing="3.2" fill="#8a1c2c" fontFamily="var(--font-serif)" fontWeight="600">
        <textPath href="#seal-circle">LITTLE JOE · ՀԱՅԱՍՏԱՆ · YEREVAN ·</textPath>
      </text>
      <g transform="translate(48 47)" fill="#8a1c2c">
        <path d="M9 3.5 10.2 5.6 12 3.8 13.8 5.6 15 3.5 15.3 6.4A8 8 0 1 1 8.7 6.4Z" transform="scale(1.05)" />
      </g>
    </svg>
  );
}

/** A few faint stars over the night Ararat. */
function StarField() {
  const stars = [
    [8, 14], [18, 30], [27, 10], [36, 22], [44, 8], [58, 18], [66, 6], [74, 26], [83, 12], [92, 22], [12, 42], [50, 36], [88, 40],
  ];
  return (
    <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden="true">
      {stars.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 ? 0.18 : 0.28} fill="#fff8f1" opacity={i % 2 ? 0.5 : 0.8} />
      ))}
    </svg>
  );
}
