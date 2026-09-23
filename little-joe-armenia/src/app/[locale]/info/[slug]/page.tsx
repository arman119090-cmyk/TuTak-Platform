import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { fmt, getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { paths } from "@/lib/paths";
import { alternates, breadcrumbLd } from "@/lib/seo/jsonld";
import { pickT } from "@/lib/catalog";
import { JsonLd } from "@/components/ui/json-ld";

type Props = { params: Promise<{ locale: string; slug: string }> };

async function load(params: Props["params"]) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const page = await db.page.findUnique({ where: { slug }, include: { translations: true } });
  const t = page ? pickT(page.translations, locale) : undefined;
  if (!page || !t) notFound();
  return { locale, page, t };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, page, t } = await load(params);
  return {
    title: t.title,
    description: t.seoDescription ?? undefined,
    alternates: alternates(locale, (l) => paths.page(l, page.slug)),
  };
}

/** Plain-text CMS body → paragraphs, "## " headings and "- " lists. No HTML is ever interpreted. */
function Body({ text, vars }: { text: string; vars: Record<string, string> }) {
  const withVars = text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] || m);
  const blocks = withVars.split(/\n\s*\n/);
  return (
    <div className="prose-lj">
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim() !== "");
        if (lines.length === 0) return null;
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{l.slice(2)}</li>
              ))}
            </ul>
          );
        }
        if (lines[0]!.startsWith("## ")) {
          const rest = lines.slice(1);
          return (
            <div key={i}>
              <h2>{lines[0]!.slice(3)}</h2>
              {rest.length ? (
                rest.every((l) => l.startsWith("- ")) ? (
                  <ul>
                    {rest.map((l, j) => (
                      <li key={j}>{l.slice(2)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{rest.join(" ")}</p>
                )
              ) : null}
            </div>
          );
        }
        return <p key={i}>{lines.join(" ")}</p>;
      })}
    </div>
  );
}

export default async function InfoPage({ params }: Props) {
  const { locale, page, t } = await load(params);
  const m = getMessages(locale);
  const contacts = await getSetting("contacts");
  return (
    <article className="container-lj max-w-3xl py-10 md:py-16">
      <JsonLd
        data={breadcrumbLd([
          { name: m.nav.home, path: paths.home(locale) },
          { name: t.title, path: paths.page(locale, page.slug) },
        ])}
      />
      {page.legalReviewRequired ? (
        <p role="note" className="mb-8 rounded-2xl bg-warn/10 px-4 py-3 text-sm font-medium text-warn" data-testid="legal-review">
          {m.common.legalReviewBanner}
        </p>
      ) : null}
      <h1 className="text-h1 font-extrabold">{t.title}</h1>
      <p className="mt-2 text-sm text-muted">{fmt(m.pages.updated, { date: page.updatedAt.toLocaleDateString(dateLocale(locale), { timeZone: "Asia/Yerevan" }) })}</p>
      <div className="mt-8">
        <Body text={t.body} vars={{ phone: contacts.phone, email: contacts.email, address: contacts.address, hours: contacts.hours }} />
      </div>
    </article>
  );
}

function dateLocale(l: Locale) {
  return l === "hy" ? "hy-AM" : l;
}
