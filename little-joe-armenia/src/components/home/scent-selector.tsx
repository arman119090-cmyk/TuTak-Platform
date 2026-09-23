"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import type { ProductCardDTO } from "@/lib/catalog";
import { useI18n } from "@/i18n/provider";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { ProductImage } from "@/components/product/product-image";
import { IconArrow } from "@/components/ui/icons";

// "Choose your Joe": a horizontal scent selector. Picking a scent recolours
// the whole section from the product's stored accent colour.

export function ScentSelector({ products, title, body }: { products: ProductCardDTO[]; title: string; body: string }) {
  const { locale, m } = useI18n();
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const current = products[index];
  if (!current) return null;

  const select = (i: number) => {
    setIndex(i);
    const el = listRef.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest", inline: "center" });
  };

  return (
    <section
      aria-labelledby="choose-title"
      className="accent-transition relative overflow-hidden py-16 md:py-24"
      style={{ background: `color-mix(in oklab, ${current.accent} 18%, #fbfbf9)` }}
    >
      <div className="container-lj grid items-center gap-10 md:grid-cols-2">
        <div className="order-2 md:order-1">
          <h2 id="choose-title" className="text-h2 font-extrabold">
            {title}
          </h2>
          <p className="mt-3 max-w-md text-ink-2">{body}</p>

          <div
            ref={listRef}
            role="radiogroup"
            aria-labelledby="choose-title"
            className="no-scrollbar -mx-4 mt-8 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-2"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                select((index + 1) % products.length);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                select((index - 1 + products.length) % products.length);
              }
            }}
          >
            {products.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={i === index}
                tabIndex={i === index ? 0 : -1}
                onClick={() => select(i)}
                className="chip shrink-0 snap-center gap-2 pr-4 pl-1.5"
              >
                <span className="size-8 rounded-full ring-2 ring-white" style={{ background: p.accent }} aria-hidden="true" />
                <span className="whitespace-nowrap">{p.name.replace(/^Little Joe\s+/, "")}</span>
              </button>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href={paths.product(locale, current.slug)} className="btn btn-primary">
              {current.name}
              <IconArrow width={18} height={18} />
            </Link>
            {current.priceAmd !== null ? <span className="text-lg font-semibold tabular-nums">{formatAmd(current.priceAmd, locale)}</span> : null}
            {current.available <= 0 ? <span className="text-sm font-semibold text-muted">{m.product.soldOut}</span> : null}
          </div>
        </div>

        <div className="order-1 md:order-2">
          <div className="relative mx-auto aspect-square w-full max-w-[34rem]">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={current.id}
                className="absolute inset-0 overflow-hidden rounded-[2rem]"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, rotate: -2 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.03 }}
                transition={{ duration: reduce ? 0.15 : 0.55, ease: [0.22, 1, 0.36, 1] }}
                style={{ background: current.accent }}
              >
                <ProductImage media={current.image} accent={current.accent} sizes="(min-width: 768px) 45vw, 92vw" />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
