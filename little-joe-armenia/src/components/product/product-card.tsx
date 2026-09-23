import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { fmt, getMessages } from "@/i18n/messages";
import type { ProductCardDTO } from "@/lib/catalog";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { ProductImage } from "@/components/product/product-image";
import { QuickAdd } from "@/components/product/quick-add";
import { FavoriteButton } from "@/components/product/favorite-button";

// Card from the brand mockup: white card, the character on a soft sky
// tinted with the scent colour, heart top-right, name, price and a full
// width blue "Add to cart". Ratings only appear when real reviews exist.

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
    <article
      className="card group relative flex h-full flex-col p-2.5 ring-1 ring-black/[0.03] transition-[transform,box-shadow] duration-500 ease-[var(--ease-out-soft)] hover:-translate-y-1 hover:shadow-[var(--shadow-lift)] motion-reduce:transform-none sm:p-3"
      data-testid="product-card"
      data-slug={p.slug}
    >
      <div
        className="relative aspect-square overflow-hidden rounded-[1rem]"
        style={{ background: `radial-gradient(120% 90% at 50% 100%, color-mix(in oklab, ${p.accent} 26%, white) 0%, #f3f8fe 62%, #ffffff 100%)` }}
      >
        <Link href={paths.product(locale, p.slug)} className="absolute inset-0 z-[1]" aria-label={p.name} tabIndex={-1} />
        <div className="absolute inset-[8%] transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:-translate-y-1 group-hover:scale-[1.04] motion-reduce:transform-none">
          <ProductImage media={p.image} accent="transparent" fit="contain" sizes="(min-width: 1280px) 16vw, (min-width: 768px) 24vw, 46vw" priority={priority} />
        </div>
        <div className="absolute left-2 top-2 z-[2] flex flex-wrap gap-1">
          {p.isNew ? <Badge>{m.catalog.new}</Badge> : null}
          {soldOut ? <Badge tone="dark">{m.product.soldOut}</Badge> : null}
        </div>
        <div className="absolute right-1 top-1 z-[2]">
          <FavoriteButton productId={p.id} initial={favorite} />
        </div>
      </div>
      <div className="flex flex-1 flex-col px-1 pt-3">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-muted">{p.collectionName}</p>
        <h3 className="mt-1 text-[1rem] font-semibold leading-snug tracking-[-0.01em]">
          <Link href={paths.product(locale, p.slug)} className="transition-colors hover:text-brand">
            {p.collectionSlug === "little-joe" ? p.name.replace(/^Little Joe\s+/, "") : p.name}
          </Link>
        </h3>
        {p.descriptor ? <p className="mt-0.5 truncate text-xs text-muted">{p.descriptor}</p> : null}
        {/* The global demo banner already says prices are placeholders; no per-card label. */}
        {p.priceAmd !== null ? (
          <p className="mt-2 text-[1.05rem] font-bold tabular-nums" data-testid="card-price">
            {formatAmd(p.priceAmd, locale)}
          </p>
        ) : null}
        {p.lowStock && !soldOut ? <p className="mt-0.5 text-xs font-medium text-warn">{fmt(m.product.lowStock, { count: p.available })}</p> : null}
        <div className="mt-auto pt-3">
          {!soldOut && p.variantId ? (
            <QuickAdd variantId={p.variantId} item={{ item_id: p.slug, item_name: p.name, price: p.priceAmd ?? 0, item_category: p.collectionName }} listName={listName} />
          ) : (
            <button type="button" disabled className="btn w-full min-h-10 bg-mist text-sm text-muted">
              {m.product.soldOut}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function Badge({ children, tone = "light" }: { children: React.ReactNode; tone?: "light" | "dark" }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${tone === "dark" ? "bg-ink text-white" : "bg-brand text-white"}`}>
      {children}
    </span>
  );
}
