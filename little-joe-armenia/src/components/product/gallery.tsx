"use client";

import { useState } from "react";
import type { MediaDTO } from "@/lib/catalog";
import { fmt } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { ProductImage } from "@/components/product/product-image";
import { Sheet } from "@/components/ui/sheet";

// Main image + thumbnails; tapping the image opens a full-screen zoom view
// where pointer position pans a 2× image (keyboard: Enter opens, Esc closes).

export function Gallery({ media, accent, name }: { media: MediaDTO[]; accent: string; name: string }) {
  const { m } = useI18n();
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const current = media[index] ?? null;

  return (
    <div className="md:sticky md:top-24">
      <div className="relative">
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="block aspect-square w-full cursor-zoom-in overflow-hidden rounded-[1.75rem] accent-transition"
          style={{ background: `radial-gradient(110% 80% at 50% 100%, color-mix(in oklab, ${accent} 30%, white) 0%, #e6f1fc 55%, #f6faff 100%)` }}
          aria-label={`${m.product.zoom}: ${current?.alt ?? name}`}
        >
          <div className="h-full w-full p-[9%]"><ProductImage media={current} accent="transparent" fit="contain" sizes="(min-width: 768px) 45vw, 90vw" priority className="drop-shadow-[0_24px_28px_rgba(20,60,120,0.22)]" /></div>
        </button>
        {current?.isPlaceholder ? (
          <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/80 px-3 py-1 text-[0.72rem] font-medium text-ink-2 backdrop-blur">
            {m.common.placeholderImage}
          </p>
        ) : null}
      </div>
      {media.length > 1 ? (
        <ul className="no-scrollbar mt-3 flex gap-2 overflow-x-auto" aria-label={m.product.gallery}>
          {media.map((img, i) => (
            <li key={`${img.url}-${i}`}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index}
                aria-label={fmt(m.product.imageOf, { n: i + 1, total: media.length })}
                className={`block size-16 overflow-hidden rounded-xl ring-2 transition sm:size-20 ${i === index ? "ring-ink" : "ring-transparent opacity-80 hover:opacity-100"}`}
                style={{ background: `radial-gradient(110% 80% at 50% 100%, color-mix(in oklab, ${accent} 30%, white) 0%, #e6f1fc 55%, #f6faff 100%)` }}
              >
                <div className="h-full w-full p-1.5"><ProductImage media={img} accent="transparent" fit="contain" sizes="80px" /></div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Sheet open={zoom} onClose={() => setZoom(false)} label={name} side="bottom" closeLabel={m.common.close}>
        <div
          className="relative aspect-square w-full touch-pan-y overflow-hidden md:mx-auto md:max-w-[80dvh]"
          style={{ background: `radial-gradient(110% 80% at 50% 100%, color-mix(in oklab, ${accent} 30%, white) 0%, #e6f1fc 55%, #f6faff 100%)` }}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
          }}
        >
          <div className="h-full w-full scale-[2] transition-transform duration-150 motion-reduce:scale-100" style={{ transformOrigin: origin }}>
            <div className="h-full w-full p-[8%]"><ProductImage media={current} accent="transparent" fit="contain" sizes="100vw" /></div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
