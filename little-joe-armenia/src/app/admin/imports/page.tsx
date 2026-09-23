import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dt, SOURCE_TYPE_LABEL } from "@/lib/admin/format";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Empty, Hidden, PageHeader } from "@/components/admin/ui";
import { resolveImportReview } from "./actions";

export const metadata: Metadata = { title: "Проверка импорта" };

const LABEL: Record<string, string> = { OPEN: "Открыт", ACCEPTED: "Принят", REJECTED: "Отклонён" };

export default async function ImportsPage() {
  await requireAdmin("imports");
  const rows = await db.importReview.findMany({ take: 300, orderBy: [{ createdAt: "desc" }] });
  // OPEN first, then newest.
  const order = { OPEN: 0, ACCEPTED: 1, REJECTED: 1 } as const;
  rows.sort((a, b) => order[a.status] - order[b.status] || b.createdAt.getTime() - a.createdAt.getTime());
  const productSlugs = [...new Set(rows.filter((r) => r.entity === "Product").map((r) => r.entityKey))];
  const products = productSlugs.length ? await db.product.findMany({ where: { slug: { in: productSlugs } }, select: { id: true, slug: true } }) : [];
  const productId = new Map(products.map((p) => [p.slug, p.id]));
  return (
    <>
      <PageHeader
        title="Проверка импорта"
        subtitle="Расхождения, найденные импортом каталога. «Принять» только фиксирует решение — значение нужно внести вручную в карточке товара."
      />
      {rows.length === 0 ? (
        <Empty>Записей нет.</Empty>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => {
            const pid = r.entity === "Product" ? productId.get(r.entityKey) : undefined;
            return (
              <li key={r.id} className="adm-card">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge status={r.status}>{LABEL[r.status]}</Badge>
                  <b>
                    {r.entity}: {pid ? <Link href={`/admin/products/${pid}#facts`} className="underline">{r.entityKey}</Link> : r.entityKey}
                  </b>
                  <span className="font-mono text-xs">{r.field}</span>
                  <span className="text-xs text-muted">
                    пакет {r.batch} · {dt(r.createdAt)}
                  </span>
                </div>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
                  <dt className="text-muted">Сейчас</dt>
                  <dd className="break-words">{r.current ?? "—"}</dd>
                  <dt className="text-muted">Предлагается</dt>
                  <dd className="break-words font-semibold">{r.proposed ?? "—"}</dd>
                  <dt className="text-muted">Причина</dt>
                  <dd>{r.reason}</dd>
                  <dt className="text-muted">Источник</dt>
                  <dd className="break-all">
                    {SOURCE_TYPE_LABEL[r.sourceType]}
                    {r.sourceUrl ? (
                      <>
                        {" · "}
                        <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                          {r.sourceUrl}
                        </a>
                      </>
                    ) : null}
                  </dd>
                </dl>
                {r.resolvedAt ? (
                  <p className="mt-1 text-xs text-muted">
                    Решение: {dt(r.resolvedAt)} · {r.resolvedBy}
                  </p>
                ) : null}
                <ActionForm action={resolveImportReview} inline className="adm-inline-form mt-2">
                  <Hidden name="reviewId" value={r.id} />
                  {r.status === "OPEN" ? (
                    <>
                      <SubmitButton name="status" value="ACCEPTED">
                        Принять
                      </SubmitButton>
                      <SubmitButton variant="danger" name="status" value="REJECTED">
                        Отклонить
                      </SubmitButton>
                    </>
                  ) : (
                    <SubmitButton variant="ghost" name="status" value="OPEN">
                      Вернуть в открытые
                    </SubmitButton>
                  )}
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
