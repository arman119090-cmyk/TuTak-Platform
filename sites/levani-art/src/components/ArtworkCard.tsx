import Image from 'next/image';
import Link from 'next/link';
import type { Artwork } from '@/content/types';
import { getArtist } from '@/content/artists';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { fill } from '@/i18n/plural';

export function artworkAlt(a: Artwork, dict: Dictionary): string {
  return fill(dict.artwork.imageAlt, { title: a.title, category: dict.categories[a.category] });
}

export function ArtworkCard({
  artwork,
  locale,
  dict,
  sizes = '(max-width: 720px) 92vw, (max-width: 1200px) 45vw, 30vw',
  priority = false,
  showMeta = true,
  showArtist = true,
  showTitle = true,
}: {
  artwork: Artwork;
  locale: Locale;
  dict: Dictionary;
  sizes?: string;
  priority?: boolean;
  showMeta?: boolean;
  /** Off where the artist is already the heading (artists page). */
  showArtist?: boolean;
  showTitle?: boolean;
}) {
  const artist = getArtist(artwork.artistSlug);
  const meta = [showArtist ? artist?.name : null, dict.categories[artwork.category], artwork.dimensions].filter(Boolean);
  return (
    <Link href={`/${locale}/artworks/${artwork.slug}`} className="card">
      <span className="card__frame">
        <Image
          src={artwork.image.src}
          width={artwork.image.width}
          height={artwork.image.height}
          alt={artworkAlt(artwork, dict)}
          sizes={sizes}
          priority={priority}
          className="card__img"
        />
        <span className="card__cta" aria-hidden="true">
          {dict.collection.viewArtwork}
        </span>
      </span>
      {showTitle ? <span className="card__title">{artwork.title}</span> : null}
      {showTitle && showMeta ? <span className="card__meta">{meta.join(' · ')}</span> : null}
    </Link>
  );
}
