import { Instagram } from 'lucide-react';
import { brand } from '@/config/brand';
import { artworkUrl } from '@/lib/media/artwork';
import type { Dictionary } from '@/lib/i18n';

const SHOTS: [string, string][] = [
  ['sofa-corner', 'emerald'],
  ['bed', 'sand'],
  ['kitchen-island', 'olive'],
  ['armchair-lounge', 'mustard'],
  ['table', 'oak'],
  ['wardrobe-sliding', 'graphite'],
];

/** Social-style strip: the same generated artwork, framed as lifestyle shots. */
export const Gallery = ({ dict }: { dict: Dictionary }) => (
  <section className="container-page py-10 md:py-14">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[26px] md:text-[32px]">{dict.home.gallery}</h2>
        <p className="mt-1.5 text-sm text-muted">{dict.home.gallerySubtitle}</p>
      </div>
      <a
        href={`https://instagram.com/${brand.contacts.instagram}`}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-2 text-[13px] text-accent hover:underline"
      >
        <Instagram width={16} height={16} /> @{brand.contacts.instagram}
      </a>
    </div>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
      {SHOTS.map(([artKey, tone], index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${artKey}-${tone}`}
          src={artworkUrl(artKey, tone, 3, 40 + index)}
          alt=""
          className="aspect-square w-full rounded-[var(--radius-sm)] bg-surface-2 object-cover"
          loading="lazy"
        />
      ))}
    </div>
  </section>
);
