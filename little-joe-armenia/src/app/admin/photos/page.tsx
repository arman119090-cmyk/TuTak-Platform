import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { pickT } from "@/lib/catalog";
import { PhotoTile } from "@/components/admin/photo-tile";

export const metadata = { title: "Фото товаров" };

export default async function PhotosPage() {
  await requireAdmin("products");
  const products = await db.product.findMany({
    where: { status: { not: "ARCHIVED" } },
    orderBy: [{ collection: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    include: {
      translations: true,
      collection: { include: { translations: true } },
      media: { orderBy: { sortOrder: "asc" }, select: { url: true } },
    },
  });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Фото товаров</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Нажмите «Загрузить фото» или «Заменить фото» у товара и выберите файл с компьютера или телефона. Новое фото сразу становится главным
          на сайте (в карточках, на главной и первым в галерее). Сервер сам развернёт фото, уменьшит до 1800 px и сожмёт. Лучше всего смотрятся
          квадратные фото товара на прозрачном или светлом фоне. Старые фото остаются в галерее — удалить или поменять порядок можно в «Все фото».
        </p>
      </header>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {products.map((p) => (
          <PhotoTile
            key={p.id}
            productId={p.id}
            name={pickT(p.translations, "ru")?.name ?? p.slug}
            collection={pickT(p.collection.translations, "ru")?.name ?? p.collection.slug}
            accent={p.accentColor ?? p.collection.accentColor ?? "#dfe7f2"}
            photo={p.media[0] ? { url: p.media[0].url, count: p.media.length } : null}
            editHref={`/admin/products/${p.id}#media`}
          />
        ))}
      </ul>
    </div>
  );
}
