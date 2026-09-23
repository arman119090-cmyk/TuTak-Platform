import type { Locale } from "@/i18n/config";
import type { ProductCardDTO } from "@/lib/catalog";
import { ProductCard } from "@/components/product/product-card";

export function ProductGrid({
  products,
  locale,
  favorites,
  listName,
  priorityCount = 0,
  columns = "default",
}: {
  products: ProductCardDTO[];
  locale: Locale;
  favorites: Set<string>;
  listName?: string;
  priorityCount?: number;
  columns?: "default" | "wide";
}) {
  return (
    <ul
      className={`grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 ${
        columns === "wide" ? "md:grid-cols-3 xl:grid-cols-4" : "md:grid-cols-3 lg:grid-cols-4"
      }`}
    >
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard p={p} locale={locale} favorite={favorites.has(p.id)} priority={i < priorityCount} listName={listName} />
        </li>
      ))}
    </ul>
  );
}
