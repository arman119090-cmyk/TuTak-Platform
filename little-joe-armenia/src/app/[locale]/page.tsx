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
import Image from "next/image";
import { lineMeta, type LineMeta } from "@/lib/lines";
import { visibleCollections } from "@/lib/catalog";
import { IconArrow, IconCard, IconChat, IconSparkle, IconTruck, IconCheck } from "@/components/ui/icons";

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
  const [home, bestsellers, all, claims, reviews, lifestyle, favorites, collections] = await Promise.all([
    homeContent(locale),
    highlighted("bestseller", locale, 6),
    allVisibleCards(locale),
    verifiedBrandClaims(locale),
    latestReviews(6),
    lifestyleMedia(locale),
    favoriteIds(),
    visibleCollections(locale),
  ]);

  // Popular row: bestsellers first, topped up with featured/other in-stock items to six.
  const popular: ProductCardDTO[] = [...bestsellers];
  for (const p of [...home.featured, ...all]) {
    if (popular.length >= 6) break;
    if (!popular.some((x) => x.id === p.id) && p.available > 0) popular.push(p);
  }
  // Product lines with their brand-book art; the five characters get their own row.
  const CHARACTERS = ["little-joya", "little-dog", "little-pup", "little-cat", "little-duck"];
  const lines = collections.map((c) => ({ ...c, meta: lineMeta(c.slug, locale) })).filter((c) => c.meta?.hero);
  const mainLines = lines.filter((c) => !CHARACTERS.includes(c.slug));
  const characters = lines.filter((c) => CHARACTERS.includes(c.slug));
  const heroTitle = home.hero?.title ?? `${m.home.heroLine1} ${m.home.heroLine2}`;
  const [line1, line2] = home.hero ? splitHeadline(heroTitle) : [m.home.heroLine1, m.home.heroLine2];
  const facts = [m.brand.factSwiss, m.brand.factItaly, m.brand.factCountries, m.brand.factIfra];

  return (
    <>
      {/* ── Hero: sky, clouds, the brand mascot with the original pack ── */}
      <section className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, #d9edfc 0%, #eef7fe 45%, #ffffff 100%)" }}>
        <Clouds />
        <div className="container-lj relative grid grid-cols-[minmax(0,1fr)] items-center gap-6 pt-10 md:min-h-[40rem] md:grid-cols-[1fr_1fr] md:gap-4 md:pt-14">
          <div className="relative z-[1] min-w-0 max-w-2xl pb-2 md:pb-16">
            <p className="display text-[0.8rem] uppercase tracking-[0.08em] text-brand">
              Little Joe® · {m.brand.country}
            </p>
            <h1 className="display hero-title mt-4 text-[clamp(2.5rem,1.4rem+4.6vw,5.2rem)] leading-[0.98]">
              <span className="block">{line1}</span>
              {line2 ? <span className="block text-brand">{line2}</span> : null}
            </h1>
            <p className="hand mt-4 -rotate-2 text-[clamp(1.6rem,1.2rem+1.4vw,2.4rem)] leading-none text-ink">{m.brand.slogan}</p>
            <p className="mt-5 max-w-md text-[1.05rem] leading-relaxed text-ink-2">{home.hero?.body ?? m.home.heroSub}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3">
              <Link href={paths.shop(locale)} className="btn btn-primary px-7">
                {m.home.goShop}
                <IconArrow width={17} height={17} />
              </Link>
              <Link href={paths.finder(locale)} className="link-arrow">
                {m.home.ctaFind}
              </Link>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[34rem] self-end">
            {/* The brand-book art has a white background; multiply lets the sky show through. */}
            <Image src="/brand/lines/little-joe.webp" alt="" width={960} height={1212} priority sizes="(min-width: 768px) 45vw, 92vw" className="h-auto w-full mix-blend-multiply" />
            <Image
              src="/brand/home/trio-joe.webp"
              alt=""
              width={1017}
              height={649}
              sizes="220px"
              className="float-slow absolute -right-2 top-[6%] hidden w-[44%] mix-blend-multiply md:block"
            />
          </div>
        </div>
      </section>

      {/* ── Service promise ── */}
      <section className="border-y border-line bg-white">
        <ul className="container-lj grid grid-cols-2 md:grid-cols-4">
          <Trust icon={<IconTruck />} title={m.home.trustDeliveryTitle} body={m.home.trustDeliveryBody} href={paths.page(locale, "delivery")} />
          <Trust icon={<IconCard />} title={m.home.trustPaymentTitle} body={m.home.trustPaymentBody} href={paths.page(locale, "payment")} />
          <Trust icon={<IconSparkle />} title={m.home.trustFinderTitle} body={m.home.trustFinderBody} href={paths.finder(locale)} />
          <Trust icon={<IconChat />} title={m.home.trustSupportTitle} body={m.home.trustSupportBody} href={paths.page(locale, "contact")} />
        </ul>
      </section>

      {/* ── Product lines ── */}
      {mainLines.length > 0 ? (
        <section className="container-lj py-16 md:py-24" aria-labelledby="lines-title">
          <SectionHead id="lines-title" title={m.brand.linesTitle} href={paths.shop(locale)} cta={m.common.seeAll} />
          <ul className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-5 md:overflow-visible md:px-0">
            {mainLines.slice(0, 8).map((c) => (
              <li key={c.slug} className="w-[64vw] max-w-[17rem] shrink-0 snap-start md:w-auto md:max-w-none">
                <LineTile c={c} href={paths.collection(locale, c.slug)} count={m.brand.lineProducts.replace("{count}", String(c.count))} />
              </li>
            ))}
          </ul>
          {mainLines.length > 8 ? (
            <ul className="mt-8 flex flex-wrap gap-2">
              {mainLines.slice(8).map((c) => (
                <li key={c.slug}>
                  <Link href={paths.collection(locale, c.slug)} className="chip">
                    <span className="size-2.5 rounded-full" style={{ background: c.accent }} aria-hidden="true" />
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* ── Popular scents ── */}
      {popular.length > 0 ? (
        <section className="bg-[linear-gradient(180deg,#f4f9fe,#ffffff)] py-16 md:py-24" aria-labelledby="popular-title">
          <div className="container-lj">
            <SectionHead id="popular-title" title={m.home.popularTitle} href={paths.shop(locale)} cta={m.common.seeAll} />
            <ProductGrid products={popular} locale={locale} favorites={favorites} listName="popular" columns="six" priorityCount={2} />
          </div>
        </section>
      ) : null}

      {/* ── The original: the brand-book world spread with the facts ── */}
      <section className="container-lj py-16 md:py-24" aria-labelledby="original-title">
        <div className="relative overflow-hidden rounded-[2rem] bg-white ring-1 ring-line shadow-[var(--shadow-card)]">
          <Image src="/brand/home/world.webp" alt="" width={2000} height={1216} sizes="(min-width: 1400px) 1300px, 100vw" className="h-auto w-full" />
          <div className="p-6 md:absolute md:bottom-8 md:right-8 md:max-w-md md:rounded-[1.5rem] md:bg-white/90 md:p-8 md:shadow-[var(--shadow-float)] md:backdrop-blur">
            <h2 id="original-title" className="display text-[clamp(2rem,1.5rem+2vw,3.2rem)] leading-none">
              {m.brand.originalTitle}
            </h2>
            <p className="mt-4 text-ink-2">{m.brand.originalBody}</p>
            <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm font-semibold">
              {facts.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <IconCheck width={18} height={18} className="mt-0.5 shrink-0 text-brand" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Characters ── */}
      {characters.length > 0 ? (
        <section className="container-lj pb-16 md:pb-24" aria-labelledby="characters-title">
          <SectionHead id="characters-title" title={m.brand.charactersTitle} />
          <ul className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:gap-5 md:overflow-visible md:px-0">
            {characters.map((c) => (
              <li key={c.slug} className="w-[60vw] max-w-[15rem] shrink-0 snap-start md:w-auto md:max-w-none">
                <LineTile c={c} href={paths.collection(locale, c.slug)} count={m.brand.lineProducts.replace("{count}", String(c.count))} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Scent finder ── */}
      <section className="container-lj pb-16 md:pb-24">
        <div className="relative overflow-hidden rounded-[2rem]" style={{ background: "linear-gradient(135deg, #d9edfc 0%, #eef7fe 50%, #ffffff 100%)" }}>
          <Clouds />
          <div className="relative grid items-center gap-6 px-6 py-12 md:grid-cols-[1.1fr_1fr] md:px-14 md:py-14">
            <div className="text-center md:text-left">
              <h2 className="display text-[clamp(2.2rem,1.5rem+2.8vw,3.8rem)] leading-[1.02]">{m.home.quizTitle}</h2>
              <p className="mx-auto mt-4 max-w-md text-ink-2 md:mx-0">{m.home.quizBody}</p>
              <Link href={paths.finder(locale)} className="btn btn-primary mt-8 px-7">
                {m.home.quizCta}
                <IconArrow width={17} height={17} />
              </Link>
              <ul className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[0.8rem] font-semibold text-ink-2 md:justify-start">
                {[m.home.quizPoint1, m.home.quizPoint2, m.home.quizPoint3].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <IconCheck width={16} height={16} className="text-brand" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <Image src="/brand/home/trio-thumbs.webp" alt="" width={1017} height={649} sizes="(min-width: 768px) 40vw, 90vw" className="float-slow mx-auto h-auto w-full max-w-[30rem] mix-blend-multiply" />
          </div>
        </div>
      </section>

      {/* ── Campaign blocks (CMS) ── */}
      {home.campaigns.length > 0 ? (
        <section className="container-lj grid gap-4 pb-12 md:grid-cols-2">
          {home.campaigns.map((c) => (
            <Link
              key={c.id}
              href={c.href && c.href.startsWith("/") ? `/${locale}${c.href}` : paths.shop(locale)}
              className="rounded-[2rem] p-8 ring-1 ring-line md:p-12"
              style={{ ["--tint" as string]: c.accent ?? "var(--color-wash)" }}
            >
              <h2 className="display text-4xl">{c.title}</h2>
              {c.body ? <p className="mt-3 max-w-md">{c.body}</p> : null}
            </Link>
          ))}
        </section>
      ) : null}

      {/* ── Brand facts: only claims verified in the admin ── */}
      {claims.length > 0 ? (
        <section className="container-lj pb-12" aria-labelledby="story-title">
          <h2 id="story-title" className="display mb-8 text-h2">
            {m.home.storyTitle}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {claims.map((c) => (
              <li key={c.key} className="border-t border-[var(--color-hairline)]/50 pt-5">
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
          <h2 id="reviews-title" className="display mb-8 text-h2">
            {m.home.reviewsTitle}
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-[1.5rem] bg-card p-7 ring-1 ring-line">
                <Stars value={r.rating} label={`${r.rating}/5`} />
                <p className="display mt-4 line-clamp-5 text-[1.2rem] font-medium italic leading-snug text-ink">«{r.body}»</p>
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
          <h2 id="social-title" className="display mb-8 text-h2">
            {m.home.socialTitle}
          </h2>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {lifestyle.map((img) => (
              <li key={img.id} className="aspect-square overflow-hidden rounded-[1.5rem]">
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
    <li className="min-w-0 border-line [&:nth-child(2n)]:border-l md:border-l md:first:border-l-0 [&:nth-child(n+3)]:border-t md:[&:nth-child(n+3)]:border-t-0">
      <Link href={href} className="group flex h-full items-start gap-3 px-3 py-6 md:px-6 md:py-7">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand transition-colors group-hover:bg-brand group-hover:text-white" aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-[0.88rem] font-bold leading-tight [overflow-wrap:anywhere]">{title}</span>
          <span className="mt-1 block text-[0.78rem] leading-snug text-muted">{body}</span>
        </span>
      </Link>
    </li>
  );
}

function SectionHead({ id, title, href, cta }: { id: string; title: string; href?: string; cta?: string }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 md:mb-10">
      <div className="min-w-0">
        <p className="display text-[0.75rem] uppercase tracking-[0.08em] text-brand">Little Joe®</p>
        <h2 id={id} className="display mt-2 text-[clamp(1.9rem,1.4rem+1.8vw,3rem)] leading-[1.02]">
          {title}
        </h2>
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

type Tile = { slug: string; name: string; accent: string; meta: LineMeta | null };

/** Product line tile: the line's brand-book art on its colour, name and tagline. */
function LineTile({ c, href, count }: { c: Tile; href: string; count: string }) {
  return (
    <Link href={href} className="group block">
      <div
        className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem] ring-1 ring-line transition-shadow duration-500 group-hover:shadow-[var(--shadow-lift)]"
        style={{ background: `color-mix(in oklab, ${c.accent} 16%, white)` }}
      >
        {c.meta?.hero ? (
          <Image
            src={c.meta.hero.url}
            alt=""
            width={c.meta.hero.width}
            height={c.meta.hero.height}
            sizes="(min-width: 768px) 24vw, 64vw"
            className="h-full w-full object-cover object-top mix-blend-multiply transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.04] motion-reduce:transform-none"
          />
        ) : null}
      </div>
      <div className="mt-3 px-1">
        <p className="display text-[1.15rem] leading-tight">{c.name}</p>
        {c.meta?.tagline ? <p className="mt-1 line-clamp-2 text-[0.82rem] text-ink-2">{c.meta.tagline}</p> : null}
        <p className="mt-1 text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted">{count}</p>
      </div>
    </Link>
  );
}

/** Soft brand-book clouds (decorative). */
function Clouds() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id="cloud-soft" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#7fb4e3" floodOpacity="0.25" />
        </filter>
      </defs>
      <g fill="#ffffff" filter="url(#cloud-soft)" opacity="0.95">
        <path d="M120 120c0-22 18-40 40-40 8-20 28-32 50-30 22 2 38 18 42 38 18 2 32 16 32 34 0 19-15 34-34 34H154c-19 0-34-16-34-36z" />
        <path d="M880 80c0-16 13-29 29-29 6-15 21-24 37-22 16 2 28 13 31 28 13 1 23 12 23 25 0 14-11 25-25 25h-70c-14 0-25-12-25-27z" />
        <path d="M1010 300c0-12 10-22 22-22 5-11 16-18 28-17 12 1 21 10 23 21 10 1 18 9 18 19 0 11-9 19-19 19h-53c-11 0-19-9-19-20z" />
        <path d="M430 60c0-10 8-18 18-18 4-9 13-14 22-13 10 1 17 8 19 17 8 1 14 7 14 15 0 9-7 15-15 15h-43c-8 0-15-7-15-16z" />
      </g>
    </svg>
  );
}
