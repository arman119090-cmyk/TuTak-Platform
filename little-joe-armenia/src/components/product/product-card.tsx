import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { fmt, getMessages } from "@/i18n/messages";
import type { ProductCardDTO } from "@/lib/catalog";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { ProductImage } from "@/components/product/product-image";
import { QuickAdd } from "@/components/product/quick-add";
import { FavoriteButton } from "@/components/product/favorite-button";

// Colour and product dominate: the card is the product's accent colour with
// the image on top; text is kept to name, collection, one descriptor, price.

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
    <article className="group relative flex flex-col" data-testid="product-card" data-slug={p.slug}>
      <div
        className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] accent-transition"
        style={{ background: p.accent }}
      >
        <Link href={paths.product(locale, p.slug)} className="absolute inset-0 z-[1]" aria-label={p.name} tabIndex={-1} />
        <div className="absolute inset-0 transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.035] motion-reduce:transform-none">
          <ProductImage media={p.image} accent={p.accent} sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 48vw" priority={priority} />
        </div>
        <div className="absolute left-3 top-3 z-[2] flex flex-wrap gap-1.5">
          {p.isNew ? <Badge>{m.catalog.new}</Badge> : null}
          {p.isBestseller ? <Badge>{m.catalog.bestseller}</Badge> : null}
          {soldOut ? <Badge tone="dark">{m.product.soldOut}</Badge> : null}
        </div>
        <div className="absolute right-2 top-2 z-[2]">
          <FavoriteButton productId={p.id} initial={favorite} />
        </div>
        {!soldOut && p.variantId ? (
          <div className="absolute inset-x-3 bottom-3 z-[2]">
            <QuickAdd variantId={p.variantId} item={{ item_id: p.slug, item_name: p.name, price: p.priceAmd ?? 0, item_category: p.collectionName }} listName={listName} />
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-start justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted">{p.collectionName}</p>
          <h3 className="mt-0.5 text-[1rem] font-semibold leading-snug">
            <Link href={paths.product(locale, p.slug)} className="hover:underline underline-offset-4">
              {p.name}
            </Link>
          </h3>
          {p.descriptor ? <p className="mt-0.5 line-clamp-1 text-sm text-muted">{p.descriptor}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          {p.priceAmd !== null ? (
            <p className="font-semibold tabular-nums" data-testid="card-price">
              {formatAmd(p.priceAmd, locale)}
            </p>
          ) : null}
          {p.compareAtAmd && p.priceAmd && p.compareAtAmd > p.priceAmd ? (
            <p className="text-xs text-muted line-through tabular-nums">{formatAmd(p.compareAtAmd, locale)}</p>
          ) : null}
          {p.priceIsDemo ? <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-warn">{m.common.demoPrice}</p> : null}
        </div>
      </div>
      {p.lowStock && !soldOut ? <p className="mt-1 px-0.5 text-xs font-medium text-warn">{fmt(m.product.lowStock, { count: p.available })}</p> : null}
    </article>
  );
}

function Badge({ children, tone = "light" }: { children: React.ReactNode; tone?: "light" | "dark" }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide ${
        tone === "dark" ? "bg-ink text-white" : "bg-white/85 text-ink backdrop-blur"
      }`}
    >
      {children}
    </span>
  );
}
