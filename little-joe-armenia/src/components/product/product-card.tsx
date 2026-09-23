import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { fmt, getMessages } from "@/i18n/messages";
import type { ProductCardDTO } from "@/lib/catalog";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { ProductImage } from "@/components/product/product-image";
import { QuickAdd } from "@/components/product/quick-add";
import { FavoriteButton } from "@/components/product/favorite-button";

// Premium card: the character stands in a round-headed arch (Armenian
// church architecture) washed in pink tuff and tinted by the scent colour.
// Below: collection, name in the display serif, price and a round "+".
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
  const name = p.collectionSlug === "little-joe" ? p.name.replace(/^Little Joe\s+/, "") : p.name;
  return (
    <article className="group relative flex h-full flex-col" data-testid="product-card" data-slug={p.slug}>
      <div className="arch tuff relative aspect-[4/5] ring-1 ring-[var(--color-tuff-2)]/60" style={{ ["--tint" as string]: p.accent }}>
        <Link href={paths.product(locale, p.slug)} className="absolute inset-0 z-[1]" aria-label={p.name} tabIndex={-1} />
        <div className="absolute inset-x-[12%] bottom-[9%] top-[16%] transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:-translate-y-1.5 group-hover:scale-[1.035] motion-reduce:transform-none">
          <ProductImage
            media={p.image}
            accent="transparent"
            fit="contain"
            sizes="(min-width: 1280px) 16vw, (min-width: 768px) 24vw, 46vw"
            priority={priority}
            className="drop-shadow-[0_18px_18px_rgba(60,30,15,0.22)]"
          />
        </div>
        {/* Soft floor shadow */}
        <div className="absolute inset-x-[22%] bottom-[7%] h-[5%] rounded-[50%] bg-[rgb(60_30_15/0.16)] blur-md" aria-hidden="true" />
        <div className="absolute inset-x-0 top-[13%] z-[2] flex justify-center gap-1">
          {p.isNew ? <Badge>{m.catalog.new}</Badge> : null}
          {soldOut ? <Badge tone="dark">{m.product.soldOut}</Badge> : null}
        </div>
        <div className="absolute bottom-2 right-2 z-[2]">
          <FavoriteButton productId={p.id} initial={favorite} />
        </div>
      </div>
      <div className="flex flex-1 items-end justify-between gap-2 px-1 pt-3.5">
        <div className="min-w-0">
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted">{p.collectionName}</p>
          <h3 className="mt-1 font-[family-name:var(--font-serif)] text-[1.2rem] font-semibold leading-[1.15] md:text-[1.3rem]">
            <Link href={paths.product(locale, p.slug)} className="transition-colors hover:text-brand">
              {name}
            </Link>
          </h3>
          {p.descriptor ? <p className="mt-0.5 truncate text-xs text-muted">{p.descriptor}</p> : null}
          {/* The global demo banner already says prices are placeholders; no per-card label. */}
          {p.priceAmd !== null ? (
            <p className="mt-1.5 text-[0.95rem] font-semibold tabular-nums text-ink-2" data-testid="card-price">
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
    <span
      className={`rounded-full px-2.5 py-1 text-[0.58rem] font-semibold uppercase tracking-[0.16em] ${
        tone === "dark" ? "bg-ink text-[#fff8f1]" : "bg-[#fff8f1]/90 text-brand ring-1 ring-brand/15"
      }`}
    >
      {children}
    </span>
  );
}
