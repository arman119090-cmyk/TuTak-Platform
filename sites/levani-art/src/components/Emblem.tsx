import type { EmblemId } from '@/i18n/config';

/**
 * Official state arms used as language emblems.
 *
 * Source: SVGs from the `coat-of-arms` npm package (v6.4.0, MIT), rasterised
 * to 120 px WebP (public/emblems) because the vector files weigh up to
 * 725 KB each. France has no official coat of arms; its de facto state
 * emblem (fasces, oak and olive, "Liberté Égalité Fraternité") is used.
 * England/English uses the Royal Coat of Arms of the United Kingdom.
 */
const files: Record<EmblemId, { src: string; width: number; height: number }> = {
  AM: { src: '/emblems/am.webp', width: 125, height: 120 },
  RU: { src: '/emblems/ru.webp', width: 109, height: 120 },
  IT: { src: '/emblems/it.webp', width: 105, height: 120 },
  DE: { src: '/emblems/de.webp', width: 93, height: 120 },
  FR: { src: '/emblems/fr.webp', width: 100, height: 120 },
  GB: { src: '/emblems/gb.webp', width: 131, height: 120 },
};

export function Emblem({
  id,
  size = 26,
  title,
  className,
  eager = false,
}: {
  id: EmblemId;
  /** Rendered height in px; width follows the arms' own proportions. */
  size?: number;
  /** Omit when the emblem sits next to visible text (decorative). */
  title?: string;
  className?: string;
  eager?: boolean;
}) {
  const f = files[id];
  return (
    // Plain <img>: a 5–16 KB static file needs no optimisation pipeline.
    <img
      className={['emblem', className].filter(Boolean).join(' ')}
      src={f.src}
      width={Math.round((size * f.width) / f.height)}
      height={size}
      alt={title ?? ''}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
    />
  );
}
