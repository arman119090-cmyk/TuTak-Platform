import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fmt, getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { db } from "@/lib/db";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { currentCustomer } from "@/lib/security/session";
import { buyAgainAction, deleteAddressAction, signOutAction } from "@/app/actions/account";
import { AddressForm } from "@/components/account/address-form";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = getMessages(await resolveLocale(params));
  return { title: m.account.title, robots: { index: false } };
}

export default async function AccountPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const customer = await currentCustomer();
  if (!customer) redirect(paths.signIn(locale));
  const [orders, addresses] = await Promise.all([
    db.order.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 50, include: { items: true } }),
    db.address.findMany({ where: { customerId: customer.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }),
  ]);

  return (
    <div className="container-lj max-w-4xl py-10 md:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 font-extrabold">{m.account.title}</h1>
          <p className="mt-2 text-ink-2">{customer.email ?? customer.phone}</p>
        </div>
        <div className="flex gap-2">
          <Link href={paths.favorites(locale)} className="btn btn-ghost">
            {m.account.favorites}
          </Link>
          <form action={signOutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="btn btn-ghost">
              {m.account.signOut}
            </button>
          </form>
        </div>
      </div>

      <section className="mt-12" aria-labelledby="orders-h">
        <h2 id="orders-h" className="mb-4 text-xl font-bold">
          {m.account.orders}
        </h2>
        {orders.length === 0 ? (
          <p className="text-ink-2">{m.account.noOrders}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <Link href={paths.order(locale, o.number)} className="font-semibold hover:underline">
                    {o.number}
                  </Link>
                  <p className="text-sm text-muted">
                    {o.createdAt.toLocaleDateString(locale === "hy" ? "hy-AM" : locale, { timeZone: "Asia/Yerevan" })} · {m.order.statuses[o.status]} ·{" "}
                    {fmt(m.catalog.results, { count: o.items.reduce((s, i) => s + i.quantity, 0) })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatAmd(o.totalAmd, locale)}</span>
                  <form action={buyAgainAction}>
                    <input type="hidden" name="orderId" value={o.id} />
                    <input type="hidden" name="locale" value={locale} />
                    <button type="submit" className="chip">
                      {m.order.buyAgain}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="addr-h">
        <h2 id="addr-h" className="mb-4 text-xl font-bold">
          {m.account.addresses}
        </h2>
        {addresses.length === 0 ? <p className="text-ink-2">{m.account.noAddresses}</p> : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="rounded-2xl bg-card p-4 ring-1 ring-line">
              <p className="font-semibold">
                {a.city}, {a.street} {a.building}
                {a.apartment ? `, ${a.apartment}` : ""}
              </p>
              <p className="text-sm text-muted">
                {m.regions[a.region as keyof typeof m.regions] ?? a.region}
                {a.isDefault ? ` · ${m.account.defaultAddress}` : ""}
              </p>
              <form action={deleteAddressAction} className="mt-2">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="locale" value={locale} />
                <button type="submit" className="tap text-sm text-muted underline">
                  {m.account.deleteAddress}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <details className="mt-6">
          <summary className="btn btn-ghost cursor-pointer list-none">{m.account.addAddress}</summary>
          <div className="mt-4 max-w-xl">
            <AddressForm />
          </div>
        </details>
      </section>
    </div>
  );
}
