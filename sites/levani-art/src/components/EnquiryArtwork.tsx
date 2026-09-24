'use client';

import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { fill } from '@/i18n/plural';

export interface EnquiryArtworkOption {
  slug: string;
  title: string;
  image: { src: string; width: number; height: number };
  alt: string;
}

/** The work named in ?artwork= (read in the browser: the page is static). */
export function useEnquiryArtwork(artworks: EnquiryArtworkOption[]) {
  const slug = useSearchParams().get('artwork') ?? '';
  return artworks.find((a) => a.slug === slug);
}

export function EnquiryArtwork({
  artworks,
  priceLabel,
  mention,
}: {
  artworks: EnquiryArtworkOption[];
  priceLabel: string;
  /** "Please mention: {title}" — shown when enquiring via Instagram. */
  mention?: string;
}) {
  const artwork = useEnquiryArtwork(artworks);
  if (!artwork) return null;
  return (
    <figure className="enquire__work">
      <Image src={artwork.image.src} width={artwork.image.width} height={artwork.image.height} alt={artwork.alt} sizes="96px" />
      <figcaption>
        {artwork.title}
        <span>{mention ? fill(mention, { title: artwork.title }) : priceLabel}</span>
      </figcaption>
    </figure>
  );
}
