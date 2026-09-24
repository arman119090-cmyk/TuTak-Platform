import type { FlagId } from '@/i18n/config';

/**
 * Language flags (4:3), from the flag-icons set shipped in the
 * `coat-of-arms` npm package (MIT). Plain SVG files in public/flags — each
 * well under 1 KB. English uses the flag of the United Kingdom.
 */
export function Flag({
  id,
  size = 16,
  title,
  className,
  eager = false,
}: {
  id: FlagId;
  /** Rendered height in px; width is 4:3. */
  size?: number;
  /** Omit when the flag sits next to visible text (decorative). */
  title?: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    // Plain <img>: a sub-kilobyte SVG needs no image pipeline.
    <img
      className={['flag', className].filter(Boolean).join(' ')}
      src={`/flags/${id}.svg`}
      width={Math.round((size * 4) / 3)}
      height={size}
      alt={title ?? ''}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
    />
  );
}
