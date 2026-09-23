import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatAmd } from "@/lib/money";
import { mockCompleteAction } from "@/app/actions/mock-pay";

type Props = { params: Promise<{ locale: string; paymentId: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MockPayPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const { paymentId } = await params;
  if (env().PAYMENTS_MODE !== "mock") {
    return <p className="container-lj py-20">{m.pay.notAvailable}</p>;
  }
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { order: { select: { number: true, status: true } } } });
  if (!payment || payment.adapter !== "mock") notFound();

  return (
    <div className="container-lj max-w-md py-16">
      <div className="rounded-[2rem] bg-card p-8 ring-1 ring-line">
        <p className="eyebrow">{m.pay.sandboxTitle}</p>
        <h1 className="mt-2 text-2xl font-extrabold">{m.checkout.payments[payment.provider]}</h1>
        <p className="mt-3 text-sm text-ink-2">{m.pay.sandboxBody}</p>
        <dl className="mt-6 flex items-baseline justify-between border-y border-line py-4">
          <dt className="text-muted">{m.pay.amount}</dt>
          <dd className="text-2xl font-bold tabular-nums" data-testid="mock-amount">
            {formatAmd(payment.amountAmd, locale)}
          </dd>
        </dl>
        <p className="mt-2 text-xs text-muted">{payment.order.number}</p>
        <form action={mockCompleteAction} className="mt-6 grid gap-2">
          <input type="hidden" name="paymentId" value={payment.id} />
          <input type="hidden" name="locale" value={locale} />
          <button type="submit" name="outcome" value="SUCCEEDED" className="btn btn-primary" data-testid="mock-approve">
            {m.pay.approve}
          </button>
          <button type="submit" name="outcome" value="FAILED" className="btn btn-ghost" data-testid="mock-decline">
            {m.pay.decline}
          </button>
        </form>
      </div>
    </div>
  );
}
