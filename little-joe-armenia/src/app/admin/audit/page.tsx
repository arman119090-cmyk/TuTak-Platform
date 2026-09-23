import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dt } from "@/lib/admin/format";
import { Empty, PageHeader, Pager, qs } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Журнал действий" };

const PER_PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ actor?: string; entity?: string; action?: string; page?: string }> }) {
  await requireAdmin("audit");
  const sp = await searchParams;
  const actor = (sp.actor ?? "").trim().slice(0, 200);
  const entity = (sp.entity ?? "").trim().slice(0, 60);
  const action = (sp.action ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.min(10000, Number(sp.page) || 1));
  const where: Prisma.AuditLogWhereInput = {
    ...(actor ? { actor: { contains: actor, mode: "insensitive" } } : {}),
    ...(entity ? { entity } : {}),
    ...(action ? { action: { startsWith: action } } : {}),
  };
  const [total, rows, entities] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Журнал действий" subtitle={`Записей: ${total}`} />
      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="actor" className="label">
            Кто
          </label>
          <input id="actor" name="actor" defaultValue={actor} className="field" />
        </div>
        <div>
          <label htmlFor="entity" className="label">
            Объект
          </label>
          <select id="entity" name="entity" defaultValue={entity} className="field">
            <option value="">Все</option>
            {entities.map((e) => (
              <option key={e.entity} value={e.entity}>
                {e.entity}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="action" className="label">
            Действие (начало)
          </label>
          <input id="action" name="action" defaultValue={action} className="field" placeholder="admin.login" />
        </div>
        <button type="submit" className="btn btn-ghost">
          Фильтр
        </button>
      </form>
      {rows.length === 0 ? (
        <Empty>Записей нет.</Empty>
      ) : (
        <div className="adm-card adm-table-wrap p-0">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Когда</th>
                <th scope="col">Кто</th>
                <th scope="col">Действие</th>
                <th scope="col">Объект</th>
                <th scope="col">Данные</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{dt(r.createdAt)}</td>
                  <td className="text-xs">{r.actor}</td>
                  <td className="font-mono text-xs">{r.action}</td>
                  <td className="text-xs">
                    {r.entity}
                    {r.entityId ? <div className="font-mono text-muted">{r.entityId}</div> : null}
                  </td>
                  <td className="max-w-md">
                    {r.data ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted">показать</summary>
                        <pre className="mt-1 max-h-64 overflow-auto rounded bg-mist p-2 text-xs whitespace-pre-wrap">{JSON.stringify(r.data, null, 2)}</pre>
                      </details>
                    ) : null}
                  </td>
                  <td className="text-xs">{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={Math.ceil(total / PER_PAGE)} href={(p) => `/admin/audit${qs({ actor, entity, action, page: p })}`} />
    </>
  );
}
