import type { Metadata } from 'next';
import { ArtworkCard } from '@/components/ArtworkCard';
import { PageIntro } from '@/components/PageIntro';
import { getArtists } from '@/content/artists';
import { getArtworks } from '@/content/catalog';
import { localized } from '@/content/localize';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/artists'>): Promise<Metadata> {
  const { locale, dict } = await resolveLocale(params);
  return pageMetadata({ locale, path: '/artists', title: dict.meta.artists, description: dict.meta.artistsDescription });
}

export default async function ArtistsPage({ params }: PageProps<'/[locale]/artists'>) {
  const { locale, dict } = await resolveLocale(params);
  const t = dict.artists;
  const works = getArtworks();
  return (
    <div className="artists">
      <PageIntro eyebrow={t.eyebrow} title={t.title} intro={t.intro} />
      {getArtists().map((artist) => {
        const own = works.filter((w) => w.artistSlug === artist.slug);
        const country = localized(artist.country, locale);
        const bio = localized(artist.biography, locale);
        const provenance = localized(artist.provenanceNotes, locale);
        return (
          <section key={artist.slug} id={artist.slug} className="artist reveal">
            <header className="artist__head">
              <h2 className="artist__name">{artist.name}</h2>
              {artist.lifeDates || country ? (
                <p className="artist__meta">{[artist.lifeDates, country].filter(Boolean).join(' · ')}</p>
              ) : null}
            </header>
            {bio ? <p className="artist__bio">{bio}</p> : null}
            {artist.exhibitions?.length ? (
              <ul className="artist__list">
                {artist.exhibitions.map((e, i) => <li key={i}>{localized(e, locale)}</li>)}
              </ul>
            ) : null}
            {provenance ? <p className="artist__bio">{provenance}</p> : null}
            <p className="eyebrow artist__works-label">{t.works}</p>
            <ul className="artist__works">
              {own.map((w) => (
                <li key={w.slug}>
                  <ArtworkCard artwork={w} locale={locale} dict={dict} sizes="(max-width: 720px) 92vw, 30vw" />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section className="artist artist--note reveal">
        <h2 className="artist__name">{t.unattributedTitle}</h2>
        <p className="artist__bio">{t.unattributedText}</p>
      </section>
    </div>
  );
}
