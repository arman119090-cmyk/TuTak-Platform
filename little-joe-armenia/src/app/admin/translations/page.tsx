import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { LOCALES, LOCALE_LABEL } from "@/lib/admin/format";
import { pickT } from "@/lib/catalog";
import { Card, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Переводы" };

type Row = { key: string; href?: string; label: string; cells: Record<string, string[] | null> };

/** null = no translation row; [] = complete; [...] = names of empty fields. */
function missing<T extends { locale: string }>(rows: T[], locale: string, fields: (keyof T & string)[]): string[] | null {
  const r = rows.find((x) => x.locale === locale);
  if (!r) return null;
  return fields.filter((f) => {
    const v = r[f];
    return v === null || v === undefined || String(v).trim() === "";
  });
}

const PRODUCT_FIELDS = ["name", "scentDescriptor", "profileDescription", "officialDescription", "usage", "seoTitle", "seoDescription"] as const;
const COLLECTION_FIELDS = ["name", "description", "seoTitle", "seoDescription"] as const;
const FAMILY_FIELDS = ["name", "description"] as const;
const TAG_FIELDS = ["name"] as const;
const PAGE_FIELDS = ["title", "body", "seoDescription"] as const;

export default async function TranslationsPage() {
  const admin = await requireAdmin("translations");
  const [products, collections, families, tags, pages] = await Promise.all([
    db.product.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { slug: "asc" }, include: { translations: true } }),
    db.collection.findMany({ orderBy: { sortOrder: "asc" }, include: { translations: true } }),
    db.fragranceFamily.findMany({ orderBy: { sortOrder: "asc" }, include: { translations: true } }),
    db.scentTag.findMany({ orderBy: { slug: "asc" }, include: { translations: true } }),
    db.page.findMany({ orderBy: { slug: "asc" }, include: { translations: true } }),
  ]);
  const canCms = admin.role !== "MANAGER";
  const sections: { title: string; fields: readonly string[]; rows: Row[] }[] = [
    {
      title: "Товары",
      fields: PRODUCT_FIELDS,
      rows: products.map((p) => ({
        key: p.id,
        href: `/admin/products/${p.id}#translations`,
        label: pickT(p.translations, "ru")?.name ?? p.slug,
        cells: Object.fromEntries(LOCALES.map((l) => [l, missing(p.translations, l, [...PRODUCT_FIELDS])])),
      })),
    },
    {
      title: "Коллекции",
      fields: COLLECTION_FIELDS,
      rows: collections.map((c) => ({
        key: c.id,
        href: canCms ? `/admin/collections/${c.id}` : undefined,
        label: pickT(c.translations, "ru")?.name ?? c.slug,
        cells: Object.fromEntries(LOCALES.map((l) => [l, missing(c.translations, l, [...COLLECTION_FIELDS])])),
      })),
    },
    {
      title: "Семейства ароматов",
      fields: FAMILY_FIELDS,
      rows: families.map((f) => ({
        key: f.id,
        href: "/admin/scent#families",
        label: pickT(f.translations, "ru")?.name ?? f.slug,
        cells: Object.fromEntries(LOCALES.map((l) => [l, missing(f.translations, l, [...FAMILY_FIELDS])])),
      })),
    },
    {
      title: "Теги ароматов",
      fields: TAG_FIELDS,
      rows: tags.map((tg) => ({
        key: tg.id,
        href: "/admin/scent#tags",
        label: pickT(tg.translations, "ru")?.name ?? tg.slug,
        cells: Object.fromEntries(LOCALES.map((l) => [l, missing(tg.translations, l, [...TAG_FIELDS])])),
      })),
    },
    {
      title: "Страницы",
      fields: PAGE_FIELDS,
      rows: pages.map((p) => ({
        key: p.id,
        href: canCms ? `/admin/pages/${p.id}` : undefined,
        label: pickT(p.translations, "ru")?.title ?? p.slug,
        cells: Object.fromEntries(LOCALES.map((l) => [l, missing(p.translations, l, [...PAGE_FIELDS])])),
      })),
    },
  ];

  return (
    <>
      <PageHeader
        title="Переводы"
        subtitle="Красное — перевода нет; жёлтое — перевод есть, но перечисленные поля пустые; зелёное — всё заполнено."
      />
      <div className="grid gap-5">
        {sections.map((s) => {
          const complete = s.rows.filter((r) => LOCALES.every((l) => r.cells[l]?.length === 0)).length;
          return (
            <Card key={s.title} title={`${s.title} — полностью: ${complete} из ${s.rows.length}`}>
              <p className="mb-2 text-xs text-muted">Поля: {s.fields.join(", ")}</p>
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th scope="col">Запись</th>
                      {LOCALES.map((l) => (
                        <th key={l} scope="col">
                          {LOCALE_LABEL[l]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((r) => (
                      <tr key={r.key}>
                        <td>{r.href ? <Link href={r.href}>{r.label}</Link> : r.label}</td>
                        {LOCALES.map((l) => {
                          const m = r.cells[l] ?? null;
                          const cls = m === null ? "adm-cell-missing" : m.length ? "adm-cell-partial" : "adm-cell-ok";
                          return (
                            <td key={l} className={`${cls} text-xs`}>
                              {m === null ? "нет перевода" : m.length ? `пусто: ${m.join(", ")}` : "✓"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
