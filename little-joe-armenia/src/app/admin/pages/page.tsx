import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dt, LOCALES, LOCALE_LABEL } from "@/lib/admin/format";
import { pickT } from "@/lib/catalog";
import { Badge, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Страницы" };

export default async function PagesPage() {
  await requireAdmin("cms");
  const pages = await db.page.findMany({ orderBy: { slug: "asc" }, include: { translations: true } });
  return (
    <>
      <PageHeader title="Страницы" subtitle="Доставка, оплата, возврат, политика конфиденциальности и т. п." />
      <div className="adm-card adm-table-wrap p-0">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Страница</th>
              <th scope="col">Переводы</th>
              <th scope="col">Юр. проверка</th>
              <th scope="col">Изменена</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/admin/pages/${p.id}`}>{pickT(p.translations, "ru")?.title ?? p.slug}</Link>
                  <div className="text-xs text-muted">/{p.slug}</div>
                </td>
                <td>
                  <div className="flex gap-1">
                    {LOCALES.map((l) => (
                      <Badge key={l} tone={p.translations.find((t) => t.locale === l && t.title.trim() && t.body.trim()) ? "ok" : "bad"}>
                        {LOCALE_LABEL[l]}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td>{p.legalReviewRequired ? <Badge tone="warn">требуется</Badge> : <Badge tone="ok">не требуется</Badge>}</td>
                <td className="whitespace-nowrap">{dt(p.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
