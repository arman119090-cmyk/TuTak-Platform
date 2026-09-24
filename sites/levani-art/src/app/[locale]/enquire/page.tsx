import type { Metadata } from 'next';
import { Suspense } from 'react';
import { artworkAlt } from '@/components/ArtworkCard';
import { EnquiryArtwork } from '@/components/EnquiryArtwork';
import { EnquiryForm } from '@/components/EnquiryForm';
import { InstagramLink } from '@/components/InstagramLink';
import { PageIntro } from '@/components/PageIntro';
import { getArtworks } from '@/content/catalog';
import { enquiry } from '@/content/site';
import { fill } from '@/i18n/plural';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/enquire'>): Promise<Metadata> {
  const { locale, dict } = await resolveLocale(params);
  return pageMetadata({ locale, path: '/enquire', title: dict.meta.enquire, description: dict.meta.enquireDescription });
}

export default async function EnquirePage({ params }: PageProps<'/[locale]/enquire'>) {
  const { locale, dict } = await resolveLocale(params);
  const t = dict.enquiry;
  const artworks = getArtworks().map((a) => ({
    slug: a.slug,
    title: a.title,
    image: a.image,
    alt: artworkAlt(a, dict),
  }));

  return (
    <div className="enquire">
      <div className="enquire__intro">
        <PageIntro eyebrow={t.eyebrow} title={t.title} intro={t.intro} />
        <Suspense fallback={null}>
          <EnquiryArtwork
            artworks={artworks}
            priceLabel={dict.artwork.priceOnRequest}
            mention={enquiry.endpoint ? undefined : t.instagramMention}
          />
        </Suspense>
      </div>
      {enquiry.endpoint ? (
        <Suspense fallback={null}>
          <EnquiryForm
            locale={locale}
            labels={t}
            artworks={artworks.map(({ slug, title }) => ({ slug, title }))}
            endpoint={enquiry.endpoint}
          />
        </Suspense>
      ) : (
        // No enquiry endpoint yet: Instagram is the working channel. No form
        // is shown, so nothing can claim a message was sent.
        <section className="enquiry-instagram" aria-labelledby="ig-title">
          <span className="enquiry-success__mark" aria-hidden="true" />
          <h2 id="ig-title" className="section-title">
            {t.instagramTitle}
          </h2>
          <p className="section-text">{t.instagramText}</p>
          <InstagramLink newTabLabel={dict.a11y.externalLink}>
            {fill(t.instagramCta, { handle: enquiry.instagramHandle })}
          </InstagramLink>
        </section>
      )}
    </div>
  );
}
