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
      media: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, url: true } },
    },
  });

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-bold">Фото товаров</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          «Добавить фото» — выберите одно или несколько фото с телефона или компьютера; первое станет главным. Нажмите на миниатюру, чтобы
          выбрать фото, и затем «Сделать главным», стрелками поменяйте порядок или удалите его. Всё сразу видно на сайте.
        </p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => (
          <PhotoTile
            key={p.id}
            productId={p.id}
            name={pickT(p.translations, "ru")?.name ?? p.slug}
            collection={pickT(p.collection.translations, "ru")?.name ?? p.collection.slug}
            accent={p.accentColor ?? p.collection.accentColor ?? "#dfe7f2"}
            photos={p.media}
            editHref={`/admin/products/${p.id}#media`}
          />
        ))}
      </ul>
    </div>
  );
}
