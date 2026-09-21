'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Portal } from '@/components/ui/portal';
import type { Dictionary } from '@/lib/i18n';

/**
 * Product gallery: thumbnails, hover zoom on desktop, swipeable strip on
 * phones and a full-screen lightbox.
 */
export const Gallery = ({
  images,
  alt,
  dict,
  badges,
}: {
  images: string[];
  alt: string;
  dict: Dictionary;
  badges?: React.ReactNode;
}) => {
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const current = images[active] ?? images[0] ?? '';

  const move = (delta: number) =>
    setActive((value) => (value + delta + images.length) % images.length);

  return (
    <div className="lg:flex lg:gap-4">
      <div className="hide-scrollbar order-first mt-3 flex gap-2 overflow-x-auto lg:mt-0 lg:w-20 lg:flex-col lg:overflow-visible">
        {images.map((image, index) => (
          <button
            key={image}
            type="button"
            onClick={() => setActive(index)}
            aria-label={`${alt} ${index + 1}`}
            aria-current={index === active}
            className={cn(
              'shrink-0 overflow-hidden rounded-[var(--radius-sm)] border-2 transition-colors',
              index === active ? 'border-ink' : 'border-transparent hover:border-line-strong',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt=""
              className="h-16 w-20 bg-surface-2 object-cover lg:h-[60px] lg:w-full"
              loading="lazy"
            />
          </button>
        ))}
      </div>

      <div className="relative flex-1">
        <div
          className="group relative overflow-hidden rounded-[var(--radius-md)] bg-surface-2"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setZoom({
              x: ((event.clientX - rect.left) / rect.width) * 100,
              y: ((event.clientY - rect.top) / rect.height) * 100,
            });
          }}
          onMouseLeave={() => setZoom(null)}
        >
          {badges ? (
            <div className="absolute left-4 top-4 z-10 flex flex-col gap-1.5">{badges}</div>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt={alt}
            className="aspect-[4/3] w-full object-cover transition-transform duration-200"
            style={
              zoom
                ? { transform: 'scale(1.7)', transformOrigin: `${zoom.x}% ${zoom.y}%` }
                : undefined
            }
          />
          <button
            type="button"
            onClick={() => setLightbox(true)}
            aria-label={dict.common.quickView}
            className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-surface/90 shadow-[var(--shadow-card)]"
          >
            <Expand width={17} height={17} />
          </button>
          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => move(-1)}
                aria-label="←"
                className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 opacity-0 shadow-[var(--shadow-card)] transition-opacity group-hover:opacity-100 max-md:opacity-100"
              >
                <ChevronLeft width={18} height={18} />
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                aria-label="→"
                className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 opacity-0 shadow-[var(--shadow-card)] transition-opacity group-hover:opacity-100 max-md:opacity-100"
              >
                <ChevronRight width={18} height={18} />
              </button>
            </>
          ) : null}
        </div>
        <p className="mt-2 hidden text-center text-[12px] text-muted lg:block">
          {dict.product.zoomHint}
        </p>
      </div>

      {lightbox ? (
        <Portal>
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/90 p-4"
            onClick={() => setLightbox(false)}
          >
            <button
              type="button"
              aria-label={dict.common.close}
              className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <X width={22} height={22} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current}
              alt={alt}
              className="max-h-[88vh] w-auto rounded-[var(--radius-md)]"
            />
          </div>
        </Portal>
      ) : null}
    </div>
  );
};
