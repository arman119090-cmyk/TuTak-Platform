import Image from "next/image";
import type { MediaDTO } from "@/lib/catalog";

// Renders a product image from any storage driver. Placeholder assets are
// SVG illustrations served from /media/placeholder (see docs/ASSETS.md);
// replacing them with authorised photos is a data change only — the slot
// keeps its aspect ratio, so layout never shifts.

export function ProductImage({
  media,
  accent,
  sizes,
  priority,
  className = "",
}: {
  media: MediaDTO | null;
  accent: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  if (!media) {
    return <div className={`aspect-square w-full ${className}`} style={{ background: accent }} aria-hidden="true" />;
  }
  const isSvg = media.url.endsWith(".svg") || media.url.includes(".svg?");
  if (isSvg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SVG placeholders need no optimisation
      <img
        src={media.url}
        alt={media.alt}
        width={media.width}
        height={media.height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }
  return (
    <Image
      src={media.url}
      alt={media.alt}
      width={media.width}
      height={media.height}
      sizes={sizes}
      priority={priority}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
