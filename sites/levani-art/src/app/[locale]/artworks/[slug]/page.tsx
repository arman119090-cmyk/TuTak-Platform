import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { artworkAlt, ArtworkCard } from '@/components/ArtworkCard';
import { ArrowLeft } from '@/components/Icons';
import { InstagramLink } from '@/components/InstagramLink';
import { InteriorPreview } from '@/components/InteriorPreview';
import { JsonLd } from '@/components/JsonLd';
import { getArtist } from '@/content/artists';
import { getArtwork, getArtworks, isLargeObject } from '@/content/catalog';
import { formatPrice, localized } from '@/content/localize';
import { enquiry } from '@/content/site';
import { locales } from '@/i18n/config';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';
import { pageUrl, siteUrl } from '@/lib/site-url';

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.flatMap((locale) => getArtworks().map((a) => ({ locale, slug: a.slug })));
}

async function resolve(params: PageProps<'/[locale]/artworks/[slug]'>['params']) {
  const { slug } = await params;
  const { locale, dict } = await resolveLocale(params);
  const artwork = getArtwork(slug);
  if (!artwork) notFound();
  return { locale, dict, artwork };
}

export async function generateMetadata({ params }: PageProps<'/[locale]/artworks/[slug]'>): Promise<Metadata> {
  const { locale, dict, artwork } = await resolve(params);
  const artist = getArtist(artwork.artistSlug);
  const description = [
    dict.categories[artwork.category],
    artist?.name,
    artwork.dimensions,
    dict.artwork.priceOnRequest,
  ]
    .filter(Boolean)
    .join(' · ');
  return pageMetadata({
    locale,
    path: `/artworks/${artwork.slug}`,
    title: artwork.title,
    description,
    image: { ...artwork.image, alt: artworkAlt(artwork, dict) },
  });
}

export default async function ArtworkPage({ params }: PageProps<'/[locale]/artworks/[slug]'>) {
  const { locale, dict, artwork } = await resolve(params);
  const a = dict.artwork;
  const base = `/${locale}`;
  const artist = getArtist(artwork.artistSlug);
  const alt = artworkAlt(artwork, dict);
  const enquire = (reason: string) => `${base}/enquire?artwork=${artwork.slug}&reason=${reason}`;

  // Only facts that exist are rendered; a null field leaves no trace.
  const facts: { label: string; value: React.ReactNode }[] = [];
  const add = (label: string, value: React.ReactNode | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') facts.push({ label, value });
  };
  add(a.fields.artist, artist ? <Link href={`${base}/artists#${artist.slug}`}>{artist.name}</Link> : null);
  add(a.fields.dimensions, artwork.dimensions);
  add(a.fields.category, dict.categories[artwork.category]);
  add(a.fields.material, localized(artwork.material, locale));
  add(a.fields.year, artwork.year);
  add(a.fields.origin, localized(artwork.origin, locale));
  add(a.fields.provenance, localized(artwork.provenance, locale));
  add(a.fields.condition, localized(artwork.condition, locale));
  add(a.fields.status, artwork.status ? a.status[artwork.status] : null);
  add(a.fields.placement, artwork.placement ? a.placement[artwork.placement] : null);

  const description = localized(artwork.description, locale);
  const delivery = localized(artwork.deliveryNotes, locale);
  const installation = localized(artwork.installationNotes, locale);
  const subtitle = localized(artwork.subtitle, locale);
  const related = getArtworks()
    .filter((x) => x.category === artwork.category && x.slug !== artwork.slug)
    .slice(0, 3);

  return (
    <article className="artwork" data-large={isLargeObject(artwork) || undefined}>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'VisualArtwork',
          name: artwork.title,
          image: `${siteUrl()}${artwork.image.src}`,
          url: pageUrl(locale, `/artworks/${artwork.slug}`),
          artform: dict.categories[artwork.category],
          ...(artist ? { creator: { '@type': 'Person', name: artist.name } } : {}),
          ...(artwork.year ? { dateCreated: artwork.year } : {}),
        }}
      />
      <div className="artwork__layout">
        <div className="artwork__stage">
          <Link href={`${base}/collection`} className="text-link artwork__back">
            <ArrowLeft /> {a.back}
          </Link>
          <div className="artwork__frame">
            <Image
              src={artwork.image.src}
              width={artwork.image.width}
              height={artwork.image.height}
              alt={alt}
              sizes="(max-width: 900px) 100vw, 60vw"
              priority
            />
          </div>
        </div>

        <aside className="artwork__panel">
          <p className="eyebrow">{dict.categories[artwork.category]}</p>
          <h1 className="artwork__title">{artwork.title}</h1>
          {subtitle ? <p className="artwork__subtitle">{subtitle}</p> : null}
          {artist ? <p className="artwork__artist">{artist.name}</p> : null}

          <dl className="facts">
            {facts.map((f) => (
              <div key={f.label} className="facts__row">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>

          <p className="artwork__price">
            {artwork.price ? formatPrice(artwork.price, locale) : a.priceOnRequest}
          </p>

          {enquiry.endpoint ? (
            <div className="artwork__actions">
              <Link href={enquire('purchase')} className="button button--solid">
                {a.enquire}
              </Link>
              <Link href={enquire('viewing')} className="button button--ghost">
                {a.privateViewing}
              </Link>
            </div>
          ) : (
            // Until an enquiry endpoint exists, Instagram is the channel.
            <div className="artwork__actions">
              <InstagramLink newTabLabel={dict.a11y.externalLink}>{a.enquireInstagram}</InstagramLink>
              <p className="artwork__ig-note">{a.instagramNote}</p>
            </div>
          )}

          {artwork.category === 'paintings' ? (
            <InteriorPreview
              image={{ ...artwork.image, alt }}
              title={artwork.title}
              enquireHref={enquiry.endpoint ? enquire('viewing') : enquiry.instagramUrl}
              labels={{
                open: a.viewInInterior,
                title: a.interiorTitle,
                placeholder: a.interiorPlaceholder,
                cta: a.interiorCta,
                close: a.close,
              }}
            />
          ) : null}

          {description ? <p className="artwork__description">{description}</p> : null}
          {delivery ? (
            <p className="artwork__note">
              <strong>{a.fields.delivery}.</strong> {delivery}
            </p>
          ) : null}
          {installation ? (
            <p className="artwork__note">
              <strong>{a.fields.installation}.</strong> {installation}
            </p>
          ) : null}
          <p className="artwork__muted">{a.detailsNote}</p>
        </aside>
      </div>

      {isLargeObject(artwork) ? (
        <section className="architectural">
          <p className="eyebrow">{a.architecturalEyebrow}</p>
          <h2 className="section-title">{a.architecturalTitle}</h2>
          <p className="section-text">{a.architecturalText}</p>
          {artwork.dimensions ? <p className="architectural__dim">{artwork.dimensions}</p> : null}
        </section>
      ) : null}

      {related.length ? (
        <section className="section related">
          <h2 className="eyebrow">{a.related}</h2>
          <ul className="related__grid">
            {related.map((r) => (
              <li key={r.slug}>
                <ArtworkCard artwork={r} locale={locale} dict={dict} sizes="(max-width: 720px) 92vw, 30vw" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
