import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dt, REVIEW_STATUS_LABEL } from "@/lib/admin/format";
import { productNames } from "@/lib/admin/queries";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Empty, Hidden, PageHeader } from "@/components/admin/ui";
import { moderateReview } from "./actions";

export const metadata: Metadata = { title: "Отзывы" };

const STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin("reviews");
  const sp = await searchParams;
  const status = STATUSES.find((x) => x === sp.status) ?? "PENDING";
  const [reviews, counts] = await Promise.all([
    db.review.findMany({ where: { status }, orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" }, take: 100 }),
    db.review.groupBy({ by: ["status"], _count: true }),
  ]);
  const names = await productNames([...new Set(reviews.map((r) => r.productId))]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  return (
    <>
      <PageHeader title="Отзывы" subtitle="На сайте показываются только одобренные отзывы." />
      <nav aria-label="Фильтр" className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/reviews?status=${s}`} className="chip" data-active={s === status}>
            {REVIEW_STATUS_LABEL[s]} · {count(s)}
          </Link>
        ))}
      </nav>
      {reviews.length === 0 ? (
        <Empty>Пусто.</Empty>
      ) : (
        <ul className="grid gap-3">
          {reviews.map((r) => (
            <li key={r.id} className="adm-card">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>{r.authorName}</b>
                <span aria-label={`Оценка ${r.rating} из 5`}>{"★".repeat(r.rating)}{"☆".repeat(Math.max(0, 5 - r.rating))}</span>
                <Badge>{r.locale.toUpperCase()}</Badge>
                {r.verifiedPurchase ? <Badge tone="ok">покупка подтверждена</Badge> : null}
                <span className="text-muted">{dt(r.createdAt)}</span>
                <Link href={`/admin/products/${r.productId}`} className="underline">
                  {names.get(r.productId) ?? "товар"}
                </Link>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm" lang={r.locale}>
                {r.body}
              </p>
              {r.moderatedAt ? (
                <p className="mt-1 text-xs text-muted">
                  {REVIEW_STATUS_LABEL[r.status]} · {dt(r.moderatedAt)} · {r.moderatedBy}
                </p>
              ) : null}
              <ActionForm action={moderateReview} inline className="adm-inline-form mt-2">
                <Hidden name="reviewId" value={r.id} />
                {r.status !== "APPROVED" ? (
                  <SubmitButton name="status" value="APPROVED">
                    Одобрить
                  </SubmitButton>
                ) : null}
                {r.status !== "REJECTED" ? (
                  <SubmitButton variant="danger" name="status" value="REJECTED">
                    Отклонить
                  </SubmitButton>
                ) : null}
                {r.status !== "PENDING" ? (
                  <SubmitButton variant="ghost" name="status" value="PENDING">
                    Вернуть в очередь
                  </SubmitButton>
                ) : null}
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
