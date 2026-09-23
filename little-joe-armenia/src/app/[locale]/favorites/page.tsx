import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { paths } from "@/lib/paths";
import { productsByIds } from "@/lib/catalog";
import { favoriteIds } from "@/lib/domain/favorites";
import { ProductGrid } from "@/components/product/product-grid";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = getMessages(await resolveLocale(params));
  return { title: m.favorites.title, robots: { index: false } };
}

export default async function FavoritesPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const ids = await favoriteIds();
  const products = await productsByIds([...ids], locale);
  return (
    <div className="container-lj py-10 md:py-14">
      <h1 className="mb-8 text-h1 font-extrabold">{m.favorites.title}</h1>
      {products.length === 0 ? (
        <div className="rounded-[var(--radius-card)] bg-mist p-10 text-center" data-testid="favorites-empty">
          <p>{m.favorites.empty}</p>
          <Link href={paths.shop(locale)} className="btn btn-primary mt-6">
            {m.cart.emptyCta}
          </Link>
        </div>
      ) : (
        <ProductGrid products={products} locale={locale} favorites={ids} listName="favorites" />
      )}
    </div>
  );
}
