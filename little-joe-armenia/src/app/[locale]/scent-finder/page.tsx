import type { Metadata } from "next";
import { getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { env } from "@/lib/env";
import { paths } from "@/lib/paths";
import { alternates } from "@/lib/seo/jsonld";
import { ScentFinder } from "@/components/home/scent-finder";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  return { title: m.finder.title, description: m.finder.intro, alternates: alternates(locale, (l) => paths.finder(l)) };
}

export default async function FinderPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  return (
    <div className="container-lj max-w-4xl py-10 md:py-16">
      <p className="eyebrow">{m.finder.title}</p>
      <p className="mt-2 mb-10 max-w-xl text-ink-2">{m.finder.intro}</p>
      <ScentFinder demo={env().DEMO_MODE} />
    </div>
  );
}
