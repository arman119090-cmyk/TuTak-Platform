import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { fmt, getMessages } from "@/i18n/messages";
import type { ProductCardDTO } from "@/lib/catalog";
import { shortName } from "@/lib/lines";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { ProductImage } from "@/components/product/product-image";
import { QuickAdd } from "@/components/product/quick-add";
import { FavoriteButton } from "@/components/product/favorite-button";

// Card in the brand-book style: the manufacturer's packshot on a soft sky,
// line name in brand blue, short product name, price and a round "+".
// Ratings only appear when real reviews exist.

export function ProductCard({
  p,
  locale,
  favorite,
  priority,
  listName,
}: {
  p: ProductCardDTO;
  locale: Locale;
  favorite: boolean;
  priority?: boolean;
  listName?: string;
}) {
  const m = getMessages(locale);
  const soldOut = p.available <= 0;
  return (
    <article className="group relative flex h-full flex-col" data-testid="product-card" data-slug={p.slug}>
      <div
        className="relative aspect-[4/5] overflow-hidden rounded-[1.5rem] ring-1 ring-line transition-shadow duration-500 group-hover:shadow-[var(--shadow-lift)]"
        style={{ background: `radial-gradient(120% 70% at 50% 100%, color-mix(in oklab, ${p.accent} 22%, white), #f3f9fe 55%, #ffffff)` }}
      >
        <Link href={paths.product(locale, p.slug)} className="absolute inset-0 z-[1]" aria-label={p.name} tabIndex={-1} />
        <div className="absolute inset-x-[14%] bottom-[7%] top-[7%] transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:-translate-y-1 group-hover:scale-[1.03] motion-reduce:transform-none">
          <ProductImage
            media={p.image}
            accent="transparent"
            fit="contain"
            sizes="(min-width: 1280px) 16vw, (min-width: 768px) 24vw, 46vw"
            priority={priority}
            className="drop-shadow-[0_16px_18px_rgba(8,40,90,0.18)]"
          />
        </div>
        <div className="absolute left-2.5 top-2.5 z-[2] flex flex-wrap gap-1">
          {p.isNew ? <Badge>{m.catalog.new}</Badge> : null}
          {soldOut ? <Badge tone="dark">{m.product.soldOut}</Badge> : null}
        </div>
        <div className="absolute right-1.5 top-1.5 z-[2]">
          <FavoriteButton productId={p.id} initial={favorite} />
        </div>
      </div>
      <div className="flex flex-1 items-end justify-between gap-2 px-1 pt-3">
        <div className="min-w-0">
          <p className="truncate text-[0.62rem] font-bold uppercase tracking-[0.14em] text-brand">{p.collectionName}</p>
          <h3 className="mt-1 text-[1rem] font-bold leading-snug tracking-[-0.01em]">
            <Link href={paths.product(locale, p.slug)} className="transition-colors hover:text-brand">
              {shortName(p.name, p.collectionName)}
            </Link>
          </h3>
          {p.descriptor ? <p className="mt-0.5 truncate text-xs text-muted">{p.descriptor}</p> : null}
          {/* The global demo banner already says prices are placeholders; no per-card label. */}
          {p.priceAmd !== null ? (
            <p className="mt-1.5 text-[0.95rem] font-bold tabular-nums" data-testid="card-price">
              {formatAmd(p.priceAmd, locale)}
            </p>
          ) : null}
          {p.lowStock && !soldOut ? <p className="mt-0.5 text-[0.7rem] font-medium text-warn">{fmt(m.product.lowStock, { count: p.available })}</p> : null}
        </div>
        {!soldOut && p.variantId ? (
          <QuickAdd compact variantId={p.variantId} item={{ item_id: p.slug, item_name: p.name, price: p.priceAmd ?? 0, item_category: p.collectionName }} listName={listName} />
        ) : null}
      </div>
    </article>
  );
}

function Badge({ children, tone = "light" }: { children: React.ReactNode; tone?: "light" | "dark" }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] ${tone === "dark" ? "bg-ink text-white" : "bg-brand text-white"}`}>
      {children}
    </span>
  );
}
