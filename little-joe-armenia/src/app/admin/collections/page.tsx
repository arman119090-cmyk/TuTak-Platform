import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { LOCALES, LOCALE_LABEL, VERIFICATION_LABEL } from "@/lib/admin/format";
import { pickT } from "@/lib/catalog";
import { Badge, Empty, LinkButton, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Коллекции" };

export default async function CollectionsPage() {
  await requireAdmin("collections");
  const rows = await db.collection.findMany({
    orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
    include: { translations: true, _count: { select: { products: true } } },
  });
  return (
    <>
      <PageHeader title="Коллекции" actions={<LinkButton href="/admin/collections/new" variant="primary">+ Новая коллекция</LinkButton>} />
      {rows.length === 0 ? (
        <Empty>Коллекций нет.</Empty>
      ) : (
        <div className="adm-card adm-table-wrap p-0">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Коллекция</th>
                <th scope="col" className="num">Порядок</th>
                <th scope="col">Видимость</th>
                <th scope="col">Проверка</th>
                <th scope="col">Переводы</th>
                <th scope="col" className="num">Товаров</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="mr-2 inline-block h-3 w-3 rounded-full border border-line align-middle" style={{ background: c.accentColor ?? "transparent" }} />
                    <Link href={`/admin/collections/${c.id}`}>{pickT(c.translations, "ru")?.name ?? c.slug}</Link>
                    <div className="text-xs text-muted">{c.slug}</div>
                  </td>
                  <td className="num">{c.sortOrder}</td>
                  <td>{c.isVisible ? <Badge tone="ok">видна</Badge> : <Badge>скрыта</Badge>}</td>
                  <td>
                    <Badge status={c.verification}>{VERIFICATION_LABEL[c.verification]}</Badge>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      {LOCALES.map((l) => (
                        <Badge key={l} tone={c.translations.find((t) => t.locale === l && t.name.trim()) ? "ok" : "bad"}>
                          {LOCALE_LABEL[l]}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="num">{c._count.products}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
