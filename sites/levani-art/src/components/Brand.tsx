import Image from 'next/image';
import { site } from '@/content/site';

/**
 * The brand in two forms, both in one place so a proper vector logo can
 * replace them later without touching any layout:
 *  - Wordmark: typographic, used in the header.
 *  - LogoPlate: the owner's emblem (currently a raster reference crop).
 */
export const logo = {
  src: '/brand/levani-art-logo-reference.jpg',
  width: 321,
  height: 343,
};

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`wordmark wordmark--${size}`}>
      <span className="wordmark__name">{site.brandName}</span>
      {size === 'lg' ? <span className="wordmark__tagline">{site.tagline}</span> : null}
    </span>
  );
}

export function LogoPlate({ width = 160, priority = false }: { width?: number; priority?: boolean }) {
  return (
    <Image
      className="logo-plate"
      src={logo.src}
      width={width}
      height={Math.round((width * logo.height) / logo.width)}
      alt={`${site.brandName} — ${site.tagline}`}
      priority={priority}
    />
  );
}
