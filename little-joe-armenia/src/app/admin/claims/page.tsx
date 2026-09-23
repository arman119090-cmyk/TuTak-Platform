import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dt, SOURCE_TYPE_LABEL, VERIFICATION_LABEL } from "@/lib/admin/format";
import { Badge, Empty, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Заявления о бренде" };

export default async function ClaimsPage() {
  await requireAdmin("cms");
  const claims = await db.brandClaim.findMany({ orderBy: [{ sortOrder: "asc" }, { key: "asc" }] });
  return (
    <>
      <PageHeader title="Заявления о бренде" subtitle="«Сделано в Италии», «швейцарская компания» и т. п. На сайте показываются только подтверждённые (VERIFIED)." />
      {claims.length === 0 ? (
        <Empty>Заявлений нет.</Empty>
      ) : (
        <div className="adm-card adm-table-wrap p-0">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Заявление</th>
                <th scope="col">Источник</th>
                <th scope="col">Проверка</th>
                <th scope="col">На сайте</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/claims/${c.id}`}>{c.titleRu}</Link>
                    <div className="font-mono text-xs text-muted">{c.key}</div>
                  </td>
                  <td className="text-xs">
                    {SOURCE_TYPE_LABEL[c.sourceType]}
                    {c.sourceUrl ? (
                      <div className="max-w-64 truncate">
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                          {c.sourceUrl}
                        </a>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <Badge status={c.verification}>{VERIFICATION_LABEL[c.verification]}</Badge>
                    {c.verifiedAt ? <div className="text-xs text-muted">{dt(c.verifiedAt)}</div> : null}
                  </td>
                  <td>{c.verification === "VERIFIED" ? <Badge tone="ok">да</Badge> : <Badge>нет</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
