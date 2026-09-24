import type { Metadata } from 'next';
import Image from 'next/image';
import { artworkAlt } from '@/components/ArtworkCard';
import { EnquiryForm } from '@/components/EnquiryForm';
import { PageIntro } from '@/components/PageIntro';
import { getArtwork, getArtworks } from '@/content/catalog';
import { enquiryReasons, type EnquiryReason } from '@/lib/enquiry';
import { resolveLocale } from '@/lib/page';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: PageProps<'/[locale]/enquire'>): Promise<Metadata> {
  const { locale, dict } = await resolveLocale(params);
  return pageMetadata({ locale, path: '/enquire', title: dict.meta.enquire, description: dict.meta.enquireDescription });
}

export default async function EnquirePage({ params, searchParams }: PageProps<'/[locale]/enquire'>) {
  const { locale, dict } = await resolveLocale(params);
  const sp = await searchParams;
  const slug = typeof sp.artwork === 'string' ? sp.artwork : '';
  const reasonParam = typeof sp.reason === 'string' ? sp.reason : '';
  const artwork = getArtwork(slug);
  const reason = (enquiryReasons as readonly string[]).includes(reasonParam) ? (reasonParam as EnquiryReason) : '';
  const t = dict.enquiry;
  return (
    <div className="enquire">
      <div className="enquire__intro">
        <PageIntro eyebrow={t.eyebrow} title={t.title} intro={t.intro} />
        {artwork ? (
          <figure className="enquire__work">
            <Image src={artwork.image.src} width={artwork.image.width} height={artwork.image.height} alt={artworkAlt(artwork, dict)} sizes="240px" />
            <figcaption>
              {artwork.title}
              <span>{dict.artwork.priceOnRequest}</span>
            </figcaption>
          </figure>
        ) : null}
      </div>
      <EnquiryForm
        locale={locale}
        labels={t}
        artworks={getArtworks().map((a) => ({ slug: a.slug, title: a.title }))}
        initialArtwork={artwork?.slug ?? ''}
        initialReason={reason}
      />
    </div>
  );
}
