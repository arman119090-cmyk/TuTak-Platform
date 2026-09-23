import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { paths } from "@/lib/paths";
import { alternates } from "@/lib/seo/jsonld";
import { formatAmd } from "@/lib/money";
import { getProduct, productsByIds } from "@/lib/catalog";
import { SCENT_AXES } from "@/lib/domain/scent";
import { ProductImage } from "@/components/product/product-image";
import { CompareSync } from "@/components/catalog/compare-sync";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ ids?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  return { title: m.compare.title, alternates: alternates(locale, (l) => paths.compare(l)), robots: { index: false, follow: true } };
}

export default async function ComparePage({ params, searchParams }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  const ids = [...new Set((await searchParams).ids?.split(",").filter((x) => /^[a-z0-9]{10,40}$/.test(x)) ?? [])].slice(0, 4);
  const cards = await productsByIds(ids, locale);
  const details = await Promise.all(cards.map((c) => getProduct(c.slug, locale)));
  const products = cards.map((c, i) => ({ card: c, detail: details[i]! })).filter((x) => x.detail);

  const dash = m.compare.notSpecified;
  const rows: { label: string; values: string[] }[] = [
    { label: m.catalog.price, values: products.map((p) => (p.card.priceAmd !== null ? formatAmd(p.card.priceAmd, locale) : dash)) },
    { label: m.product.collection, values: products.map((p) => p.card.collectionName) },
    { label: m.product.fragranceFamily, values: products.map((p) => p.card.familyName ?? dash) },
    {
      label: m.product.intensity,
      values: products.map((p) => (p.detail.scent.intensity !== null ? m.product.intensityLevels[String(p.detail.scent.intensity) as "1"] : dash)),
    },
    ...SCENT_AXES.map((a) => ({
      label: m.product.axes[a],
      values: products.map((p) => (p.detail.scent[a] !== null ? `${p.detail.scent[a]}/5` : dash)),
    })),
    { label: m.product.format, values: products.map((p) => (p.detail.format ? m.product.formats[p.detail.format] : dash)) },
    { label: m.catalog.availability, values: products.map((p) => (p.card.available > 0 ? m.product.inStock : m.product.soldOut)) },
  ];

  return (
    <div className="container-lj py-10 md:py-14">
      <CompareSync ids={products.map((p) => p.card.id)} />
      <h1 className="text-h1 font-extrabold">{m.compare.title}</h1>
      {products.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-card)] bg-mist p-10 text-center">
          <p>{m.compare.empty}</p>
          <Link href={paths.shop(locale)} className="btn btn-primary mt-6">
            {m.compare.browse}
          </Link>
        </div>
      ) : (
        <div className="mt-8 -mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[36rem] border-separate border-spacing-x-3 text-left">
            <caption className="sr-only">{m.compare.title}</caption>
            <thead>
              <tr>
                <td />
                {products.map((p) => (
                  <th key={p.card.id} scope="col" className="w-1/4 align-top font-normal">
                    <Link href={paths.product(locale, p.card.slug)} className="block">
                      <div className="aspect-square overflow-hidden rounded-2xl" style={{ background: p.card.accent }}>
                        <ProductImage media={p.card.image} accent={p.card.accent} sizes="25vw" />
                      </div>
                      <p className="mt-3 font-bold">{p.card.name}</p>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="border-t border-line py-3 pr-2 text-sm font-medium text-muted">
                    {r.label}
                  </th>
                  {r.values.map((v, i) => (
                    <td key={i} className="border-t border-line py-3 text-sm font-medium">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
