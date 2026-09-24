import Image from 'next/image';
import Link from 'next/link';
import { artworkAlt, ArtworkCard } from '@/components/ArtworkCard';
import { ArrowRight } from '@/components/Icons';
import { JsonLd } from '@/components/JsonLd';
import { getArtworks, getArtworksByCategory, getFeatured, getPopulatedCategories } from '@/content/catalog';
import { site } from '@/content/site';
import { formatCount } from '@/i18n/plural';
import { resolveLocale } from '@/lib/page';
import { pageUrl } from '@/lib/site-url';

export default async function Home({ params }: PageProps<'/[locale]'>) {
  const { locale, dict } = await resolveLocale(params);
  const h = dict.home;
  const base = `/${locale}`;
  const [hero] = getFeatured('hero');
  const [lead] = getFeatured('lead');
  const pair = getFeatured('pair');
  const [moment] = getFeatured('moment');
  const alongside = getArtworks().filter((a) => ['ethereal-grace', 'imperial-wild-boar'].includes(a.slug));
  const fountains = getArtworksByCategory('fountains-garden').filter((a) => a.slug !== moment?.slug);
  const cats = getPopulatedCategories();

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ArtGallery',
          name: site.brandName,
          slogan: site.tagline,
          url: pageUrl(locale, ''),
        }}
      />

      {/* Hero ------------------------------------------------------------ */}
      <section className="hero">
        <div className="hero__text">
          <p className="hero__tagline">{site.tagline}</p>
          <h1 className="hero__title">{site.brandName}</h1>
          <p className="hero__line">{h.heroLine}</p>
          <div className="hero__actions">
            <Link href={`${base}/collection`} className="button button--solid">
              {h.exploreCta}
            </Link>
            <Link href={`${base}/enquire`} className="button button--ghost">
              {h.privateCta}
            </Link>
          </div>
        </div>
        {hero ? (
          <Link href={`${base}/artworks/${hero.slug}`} className="hero__media">
            <Image
              src={hero.image.src}
              width={hero.image.width}
              height={hero.image.height}
              alt={artworkAlt(hero, dict)}
              sizes="(max-width: 900px) 100vw, 46vw"
              priority
              fetchPriority="high"
            />
            <span className="hero__caption">{hero.title}</span>
          </Link>
        ) : null}
      </section>

      {/* Featured -------------------------------------------------------- */}
      <section className="section featured">
        <header className="section-head reveal">
          <p className="eyebrow">{h.featuredEyebrow}</p>
          <h2 className="section-title">{h.featuredTitle}</h2>
          <p className="section-text">{h.featuredText}</p>
        </header>
        <div className="featured__grid">
          {lead ? (
            <div className="featured__lead reveal">
              <ArtworkCard artwork={lead} locale={locale} dict={dict} sizes="(max-width: 900px) 92vw, 58vw" />
            </div>
          ) : null}
          <div className="featured__pair">
            {pair.map((a) => (
              <div key={a.slug} className="reveal">
                <ArtworkCard artwork={a} locale={locale} dict={dict} sizes="(max-width: 900px) 92vw, 30vw" />
              </div>
            ))}
          </div>
        </div>
        <div className="featured__alternate">
          {alongside.map((a, i) => (
            <article key={a.slug} className={`split reveal ${i % 2 ? 'split--flip' : ''}`}>
              <div className="split__media">
                <ArtworkCard artwork={a} locale={locale} dict={dict} showTitle={false} sizes="(max-width: 900px) 92vw, 44vw" />
              </div>
              <div className="split__text">
                <p className="eyebrow">{dict.categories[a.category]}</p>
                <h3 className="split__title">{a.title}</h3>
                {a.dimensions ? <p className="split__meta">{a.dimensions}</p> : null}
                <Link href={`${base}/artworks/${a.slug}`} className="text-link">
                  {dict.collection.viewArtwork} <ArrowRight />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Architectural moment ------------------------------------------- */}
      {moment ? (
        <section className="moment">
          <div className="moment__inner">
            <div className="moment__text reveal">
              <p className="eyebrow">{h.momentEyebrow}</p>
              <h2 className="moment__title">{h.momentTitle}</h2>
              <p className="section-text">{h.momentText}</p>
              <Link href={`${base}/collection/fountains-garden`} className="text-link">
                {dict.categories['fountains-garden']} <ArrowRight />
              </Link>
            </div>
            <Link href={`${base}/artworks/${moment.slug}`} className="moment__media reveal">
              <Image
                src={moment.image.src}
                width={moment.image.width}
                height={moment.image.height}
                alt={artworkAlt(moment, dict)}
                sizes="(max-width: 900px) 92vw, 40vw"
              />
              <span className="moment__caption">
                {moment.title}
                {moment.dimensions ? <em> · {moment.dimensions}</em> : null}
              </span>
            </Link>
            <ul className="moment__row">
              {fountains.map((a) => (
                <li key={a.slug} className="reveal">
                  <ArtworkCard artwork={a} locale={locale} dict={dict} sizes="(max-width: 900px) 45vw, 20vw" />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* Categories index ------------------------------------------------ */}
      <section className="section index">
        <header className="section-head reveal">
          <p className="eyebrow">{h.categoriesEyebrow}</p>
          <h2 className="section-title">{dict.meta.collection}</h2>
        </header>
        <ol className="index__list">
          {cats.map((c, i) => {
            const items = getArtworksByCategory(c);
            const cover = items[0]!;
            return (
              <li key={c} className="reveal">
                <Link href={`${base}/collection/${c}`} className="index__row">
                  <span className="index__num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="index__name">{dict.categories[c]}</span>
                  <span className="index__intro">{dict.categoryIntro[c]}</span>
                  <span className="index__count">{formatCount(locale, items.length, h.pieces)}</span>
                  <span className="index__thumb" aria-hidden="true">
                    <Image src={cover.image.src} alt="" width={160} height={Math.round((160 * cover.image.height) / cover.image.width)} sizes="160px" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Philosophy ------------------------------------------------------ */}
      <section className="philosophy">
        <div className="philosophy__inner reveal">
          <p className="eyebrow">{h.philosophyEyebrow}</p>
          <h2 className="philosophy__title">{h.philosophyTitle}</h2>
          <p className="philosophy__text">{h.philosophyText}</p>
        </div>
      </section>

      {/* Private clients ------------------------------------------------- */}
      <section className="section private-cta">
        <div className="private-cta__inner reveal">
          <p className="eyebrow">{h.privateEyebrow}</p>
          <h2 className="section-title">{h.privateTitle}</h2>
          <p className="section-text">{h.privateText}</p>
          <div className="hero__actions">
            <Link href={`${base}/private-clients`} className="button button--solid">
              {h.advisorCta}
            </Link>
            <Link href={`${base}/collection`} className="button button--ghost">
              {h.viewAll}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
